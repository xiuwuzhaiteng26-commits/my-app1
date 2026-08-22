/**
 * スプレッドシート（データ保存先）まわり。
 * 各テーブルを1枚のスプレッドシートのシート（タブ）として持つ。
 */

var SHEETS = {
  CALENDAR: 'calendar_income_entries',
  MANUAL: 'manual_income_entries',
  LIMITS: 'company_hour_limits',
  WALLS: 'wall_thresholds',
  RECONCILE: 'monthly_reconciliation',
  SUMMARY: 'サマリー',
  LOG: '実行ログ'
};

/** 各シートの列定義（この順にヘッダー行を作る） */
var SCHEMA = {};
SCHEMA[SHEETS.CALENDAR] = [
  'id',
  'date',
  'company_name',
  'start_time',
  'end_time',
  'break_hours',
  'worked_hours',
  'hourly_wage',
  'estimated_amount',
  'reconciled',
  'source_title',
  'updated_at'
];
SCHEMA[SHEETS.MANUAL] = [
  'id',
  'source_name',
  'income_category',
  'period',
  'amount',
  'expenses',
  'note',
  'updated_at'
];
SCHEMA[SHEETS.LIMITS] = ['company_name', 'monthly_hour_limit', 'confirmed', 'note', 'updated_at'];
SCHEMA[SHEETS.WALLS] = ['name', 'amount', 'applicable_year', 'last_updated', 'note'];
SCHEMA[SHEETS.RECONCILE] = [
  'id',
  'year_month',
  'company_name',
  'actual_amount',
  'estimated_amount',
  'diff',
  'diff_rate',
  'status',
  'note',
  'entered_at'
];
SCHEMA[SHEETS.LOG] = ['executed_at', 'kind', 'level', 'message'];

/** 収入区分（manual_income_entries.income_category に入れられる値） */
var INCOME_CATEGORY = {
  SALARY: '給与所得',
  BUSINESS: '事業所得',
  MISC: '雑所得'
};

/**
 * 操作対象のスプレッドシートを返す。
 * コンテナバインド（スプレッドシートの「拡張機能 > Apps Script」から作成）なら
 * そのスプレッドシート、スタンドアロンならスクリプトプロパティ SPREADSHEET_ID を使う。
 */
function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error(
      'スプレッドシートが見つかりません。スプレッドシートに紐づけて実行するか、' +
        'スクリプトプロパティ SPREADSHEET_ID を設定してください。'
    );
  }
  return SpreadsheetApp.openById(id);
}

/** シートを取得（無ければヘッダー付きで作成） */
function getSheet_(name) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = SCHEMA[name];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/** 全シートを用意し、初期データ（設定値）を流し込む */
function ensureSheets_() {
  var ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (key) {
    getSheet_(SHEETS[key]);
  });
  seedWallThresholds_();
  var first = ss.getSheets()[0];
  if (first.getName() === 'シート1' || first.getName() === 'Sheet1') {
    if (first.getLastRow() === 0) ss.deleteSheet(first);
  }
  // サマリーを先頭タブへ
  var summary = ss.getSheetByName(SHEETS.SUMMARY);
  ss.setActiveSheet(summary);
  ss.moveActiveSheet(1);
}

/** wall_thresholds が空なら CONFIG の値で初期化する */
function seedWallThresholds_() {
  var table = readTable_(SHEETS.WALLS);
  if (table.rows.length > 0) return;
  var rows = CONFIG.walls.thresholds.map(function (w) {
    return {
      name: w.name,
      amount: w.amount,
      applicable_year: w.applicableYear,
      last_updated: w.lastUpdated,
      note: w.note
    };
  });
  appendRows_(SHEETS.WALLS, rows);
}

/**
 * シートを読み込み、{ headers, rows } を返す。rows は列名をキーにしたオブジェクトの配列。
 * 日付・時刻セルは文字列に正規化して返す（表示形式の違いを吸収するため）。
 */
function readTable_(name) {
  var sheet = getSheet_(name);
  var headers = SCHEMA[name] || [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { headers: headers, rows: [] };
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  values.forEach(function (line, i) {
    var isEmpty = line.every(function (v) {
      return v === '' || v === null;
    });
    if (isEmpty) return;
    var obj = { _rowIndex: i + 2 };
    headers.forEach(function (h, c) {
      obj[h] = line[c];
    });
    rows.push(obj);
  });
  return { headers: headers, rows: rows };
}

/** オブジェクト配列をシート末尾に追記 */
function appendRows_(name, objects) {
  if (!objects || objects.length === 0) return;
  var sheet = getSheet_(name);
  var headers = SCHEMA[name];
  var values = objects.map(function (o) {
    return headers.map(function (h) {
      return o[h] === undefined ? '' : o[h];
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

/**
 * keyField をキーに更新／追加する。
 * mergeFn(existingRow, newObject) で既存値を引き継げる（reconciled の保持など）。
 */
function upsertRows_(name, objects, keyField, mergeFn) {
  if (!objects || objects.length === 0) return { updated: 0, inserted: 0 };
  var sheet = getSheet_(name);
  var headers = SCHEMA[name];
  var table = readTable_(name);
  var index = {};
  table.rows.forEach(function (r) {
    index[String(r[keyField])] = r;
  });

  var toAppend = [];
  var updated = 0;
  objects.forEach(function (o) {
    var existing = index[String(o[keyField])];
    var merged = mergeFn && existing ? mergeFn(existing, o) : o;
    var line = headers.map(function (h) {
      return merged[h] === undefined ? '' : merged[h];
    });
    if (existing) {
      sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([line]);
      updated++;
    } else {
      toAppend.push(line);
    }
  });
  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }
  return { updated: updated, inserted: toAppend.length };
}

/** 行番号を指定して1行を書き換える（手入力された行をそのまま更新するときに使う） */
function writeRowAt_(name, rowIndex, obj) {
  var sheet = getSheet_(name);
  var headers = SCHEMA[name];
  var line = headers.map(function (h) {
    return obj[h] === undefined ? '' : obj[h];
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([line]);
}

/** 実行ログに1行追記（直近500件だけ残す） */
function writeLog_(kind, level, message) {
  var sheet = getSheet_(SHEETS.LOG);
  sheet.appendRow([formatDateTime_(new Date()), kind, level, message]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 501) sheet.deleteRows(2, lastRow - 501);
}
