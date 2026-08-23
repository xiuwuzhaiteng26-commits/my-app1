/**
 * スプレッドシート（データ保存先）まわり。
 * 各テーブルを1枚のスプレッドシートのシート（タブ）として持つ。
 */

var SHEETS = {
  CALENDAR: '勤務明細',
  MANUAL: '手入力の収入',
  LIMITS: '勤務先の上限',
  WALLS: '壁の設定',
  RECONCILE: '月次の答え合わせ',
  SUMMARY: 'サマリー',
  LOG: '実行ログ'
};

/**
 * 以前の英語シート名。既存のスプレッドシートを開いたときに日本語名へ付け替える
 * （中身はそのまま引き継ぐ）。
 */
var LEGACY_SHEET_NAMES = {};
LEGACY_SHEET_NAMES[SHEETS.CALENDAR] = 'calendar_income_entries';
LEGACY_SHEET_NAMES[SHEETS.MANUAL] = 'manual_income_entries';
LEGACY_SHEET_NAMES[SHEETS.LIMITS] = 'company_hour_limits';
LEGACY_SHEET_NAMES[SHEETS.WALLS] = 'wall_thresholds';
LEGACY_SHEET_NAMES[SHEETS.RECONCILE] = 'monthly_reconciliation';

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
SCHEMA[SHEETS.LIMITS] = [
  'company_name',
  'monthly_hour_limit',
  'confirmed',
  'note',
  'updated_at',
  // 以下は後から追加した列。既存シートの並びを崩さないよう末尾に足している
  'weekly_hour_limit',
  'consecutive_months',
  'basis'
];
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

/**
 * シートの1行目に表示する見出し（日本語）。
 * 列の並びは SCHEMA と同じで、読み書きは位置で行うため、
 * ここを変えても処理には影響しない（表示だけが変わる）。
 */
var HEADER_LABELS = {};
HEADER_LABELS[SHEETS.CALENDAR] = [
  'ID',
  '日付',
  '勤務先',
  '開始',
  '終了',
  '休憩(h)',
  '実働(h)',
  '時給(円)',
  '推定収入(円)',
  '照合済み',
  '元の予定タイトル',
  '更新日時'
];
HEADER_LABELS[SHEETS.MANUAL] = ['ID', '収入元', '区分', '対象期間', '金額(円)', '必要経費(円)', 'メモ', '更新日時'];
HEADER_LABELS[SHEETS.LIMITS] = [
  '勤務先',
  '月間上限(h)',
  '確定',
  'メモ',
  '更新日時',
  '週の上限(h)',
  '連続月数',
  '根拠'
];
HEADER_LABELS[SHEETS.WALLS] = ['壁の名前', '金額(円)', '適用年', '最終更新日', '備考'];
HEADER_LABELS[SHEETS.RECONCILE] = [
  'ID',
  '年月',
  '勤務先',
  '実際の支給額(円)',
  'カレンダー推定額(円)',
  '差分(円)',
  '差分率',
  '状態',
  'メモ',
  '入力日時'
];
HEADER_LABELS[SHEETS.LOG] = ['実行日時', '種別', 'レベル', '内容'];

/** 収入区分（手入力の収入シートの「区分」に入れられる値） */
var INCOME_CATEGORY = {
  SALARY: '給与所得',
  BUSINESS: '事業所得',
  MISC: '雑所得'
};

/**
 * 日付・時刻として自動変換されると困る列（ロケールによって表示や値が変わるため、
 * シート作成時に「書式なしテキスト」にしておく）
 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEETS.CALENDAR] = ['date', 'start_time', 'end_time', 'updated_at'];
TEXT_COLUMNS[SHEETS.MANUAL] = ['period', 'updated_at'];
TEXT_COLUMNS[SHEETS.LIMITS] = ['updated_at'];
TEXT_COLUMNS[SHEETS.WALLS] = ['last_updated'];
TEXT_COLUMNS[SHEETS.RECONCILE] = ['year_month', 'entered_at'];
TEXT_COLUMNS[SHEETS.LOG] = ['executed_at'];

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
      var labels = HEADER_LABELS[name] || headers;
      sheet.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      (TEXT_COLUMNS[name] || []).forEach(function (column) {
        var index = headers.indexOf(column);
        if (index < 0) return;
        sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    }
  }
  return sheet;
}

/** 全シートを用意し、初期データ（設定値）を流し込む */
function ensureSheets_() {
  var ss = getSpreadsheet_();
  migrateLegacySheetNames_();
  Object.keys(SHEETS).forEach(function (key) {
    getSheet_(SHEETS[key]);
  });
  refreshHeaderLabels_();
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

/** 英語名で作られた既存のシートを日本語名に付け替える（中身はそのまま） */
function migrateLegacySheetNames_() {
  var ss = getSpreadsheet_();
  Object.keys(LEGACY_SHEET_NAMES).forEach(function (current) {
    if (ss.getSheetByName(current)) return;
    var legacy = ss.getSheetByName(LEGACY_SHEET_NAMES[current]);
    if (legacy) legacy.setName(current);
  });
}

/** 1行目の見出しを日本語に揃える（英語見出しのまま作られたシートの移行用） */
function refreshHeaderLabels_() {
  Object.keys(HEADER_LABELS).forEach(function (name) {
    var labels = HEADER_LABELS[name];
    var sheet = getSheet_(name);
    var current = sheet.getRange(1, 1, 1, labels.length).getValues()[0];
    var same = true;
    labels.forEach(function (label, i) {
      if (String(current[i]) !== label) same = false;
    });
    if (!same) {
      sheet.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    }
  });
}

/** 壁の設定が空なら CONFIG の値で初期化する */
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
  var unchanged = 0;
  objects.forEach(function (o) {
    var existing = index[String(o[keyField])];
    var merged = mergeFn && existing ? mergeFn(existing, o) : o;
    var line = headers.map(function (h) {
      return merged[h] === undefined ? '' : merged[h];
    });
    if (existing) {
      // 中身が同じ行は書き込まない（毎回1ヶ月分を取り込んでも重くならないように）
      if (isSameRow_(headers, existing, line)) {
        unchanged++;
        return;
      }
      sheet.getRange(existing._rowIndex, 1, 1, headers.length).setValues([line]);
      updated++;
    } else {
      toAppend.push(line);
    }
  });
  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }
  return { updated: updated, inserted: toAppend.length, unchanged: unchanged };
}

/** 既存の行と、これから書く行が同じ内容か（updated_at は比較しない） */
function isSameRow_(headers, existingRow, line) {
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    if (header === 'updated_at' || header === 'entered_at' || header === 'executed_at') continue;
    var before = existingRow[header];
    if (before instanceof Date) {
      before = header.indexOf('time') >= 0 ? toTimeString_(before) : toDateString_(before);
    }
    var after = line[i];
    if (String(before == null ? '' : before) !== String(after == null ? '' : after)) return false;
  }
  return true;
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
