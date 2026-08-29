/**
 * 年収の壁・労働時間管理ツール（全部入り1ファイル版）
 *
 * このファイルは自動生成です。直接編集せず、apps-script/ の各ファイルを直して
 * `npm run build:apps-script` で作り直してください。
 *
 * 使い方: Apps Script エディタのファイルにこの内容をすべて貼り付けて保存する。
 * 別途 appsscript.json のタイムゾーンを Asia/Tokyo にしておくこと。
 */

/* ======================= Config.js ======================= */

/**
 * 設定ファイル
 *
 * 壁の金額・会社ごとの労働時間上限などの「年度や会社の回答によって変わる値」は
 * ここと、スプレッドシートの wall_thresholds / company_hour_limits シートで管理する。
 * ロジック側にはハードコードしないこと。
 *
 * ここの値は「初回セットアップ時にシートへ書き込まれる初期値」。
 * 運用開始後はスプレッドシート側の値が優先される（スマホから直接直せるようにするため）。
 */
var CONFIG = {
  /** 設定そのものの最終更新日（年度更新したら必ず更新する） */
  configLastUpdated: '2026-08-28',

  /** タイムゾーン（日付の切れ目の判定に使う） */
  timeZone: 'Asia/Tokyo',

  /**
   * 読み取るカレンダー。'primary' でログインアカウントのデフォルトカレンダー。
   * 他のGoogleアカウントの予定も取り込みたい場合は、そのカレンダーを
   * このスクリプトを実行しているアカウントと共有した上で、配列に追記する。
   *   calendarIds: ['primary', 'other-account@gmail.com']
   * 共有のしかたは apps-script/README.md の「複数アカウントのカレンダーをまとめる」を参照。
   */
  calendarIds: ['primary'],

  /** 集計対象年。0 なら実行日の年を使う */
  targetYear: 0,

  /** 毎日の実行 */
  daily: {
    /**
     * 当日だけでなく、過去何日分を毎晩見直すか。
     * 予定を後から書き足したり直したりしても拾えるようにするための保険。
     * 取り込みは上書きなので、何度見直しても二重計上にはならない。
     */
    lookbackDays: 31
  },

  /** 労働時間の警告（4分の3基準の暫定運用） */
  hours: {
    /** 会社ごとの月間実働時間の暫定上限。正社員の所定労働時間の回答が来たら会社ごとに差し替える */
    defaultMonthlyLimit: 120,
    /** 上限のこの割合に達したら「注意」 */
    warnRatio: 0.8,
    /** 上限のこの割合に達したら「警告」 */
    alertRatio: 1.0
  },

  /** アプリ画面 */
  app: {
    /**
     * アプリを開いたとき、直近何日分のカレンダーをその場で取り込むか。
     * 毎晩23:30を待たずに、書いた予定がすぐ反映されるようにするためのもの。
     * 0 にすると自動取り込みをしない。
     * 内容が変わっていない行は書き込まないので、日数を増やしても重くならない。
     */
    autoImportDays: 31
  },

  /** この先の見込み（先読みと調整アドバイス） */
  forecast: {
    /** 何日先までのカレンダーを読むか */
    lookaheadDays: 35,
    /** 年末着地の目安を出すときに、直近何ヶ月の平均を使うか */
    paceMonths: 3
  },

  /** 年収の壁（暫定値・年度更新前提） */
  walls: {
    /** 壁のこの割合に達したら「注意」 */
    warnRatio: 0.9,
    thresholds: [
      {
        name: '123万円',
        amount: 1230000,
        applicableYear: 2026,
        lastUpdated: '2026-08-22',
        note: '所得税・扶養控除に関する壁の目安'
      },
      {
        name: '130万円',
        amount: 1300000,
        applicableYear: 2026,
        lastUpdated: '2026-08-28',
        note:
          '健康保険の被扶養者認定の収入要件。勤務先の規模によっては106万円で社会保険加入の' +
          '対象になる場合がある。※19歳以上23歳未満は2025年10月から150万円に緩和されているため、' +
          '該当する場合はこの行を150万円に書き換えること（日本年金機構）'
      },
      {
        name: '150万円（親の控除）',
        amount: 1500000,
        applicableYear: 2026,
        lastUpdated: '2026-08-28',
        /** 制度変更や名前の整理で置き換わった、古い壁の名前 */
        replaces: ['150万円'],
        note:
          '親の特定親族特別控除（63万円）が満額のままでいられる壁の目安（2025年度税制改正、19〜22歳の子が対象）。' +
          'これを超えても直ちに0円にはならず、188万円まで段階的に減っていく。学生本人の税金・社会保険とは別の、' +
          '親の税金に関わる壁'
      }
    ]
  },

  /**
   * 給与所得控除（合計所得金額の計算に使う）。
   * deduction = min(収入, max(minimum, 収入 * rate + plus))
   * このツールが主に扱うのは収入190万円以下の範囲なので、そこでは一律 minimum(65万円)になる。
   */
  salaryDeduction: {
    minimum: 650000,
    lastUpdated: '2026-08-22',
    brackets: [
      { upTo: 1900000, rate: 0, plus: 650000 },
      { upTo: 3600000, rate: 0.3, plus: 80000 },
      { upTo: 6600000, rate: 0.2, plus: 440000 },
      { upTo: 8500000, rate: 0.1, plus: 1100000 },
      { upTo: null, rate: 0, plus: 1950000 }
    ]
  },

  /** 月次の答え合わせ（給与明細との差分がこれを超えたら警告） */
  reconcile: {
    toleranceRate: 0.05,
    toleranceAmount: 3000
  },

  /**
   * 通知設定。
   *   'sheet'   … サマリーシートと実行ログの更新のみ（外部送信なし・既定）
   *   'email'   … 実行アカウントのGmailへメール送信
   *   'webhook' … Slack / Discord / 任意のWebhookへPOST
   */
  notify: {
    channel: 'email',
    /** 空ならスクリプト実行アカウントのメールアドレス宛 */
    emailTo: '',
    /** channel が 'sheet' でも、注意・警告が出た日だけはメールを送りたい場合は true */
    alwaysNotifyOnAlert: false,
    webhookUrl: '',
    /** 'slack' | 'discord' | 'json' */
    webhookFormat: 'slack'
  },

  /** 免責表示（サマリーシート先頭と全通知の末尾に常時表示する） */
  disclaimer:
    '【免責】本ツールの金額・時間の壁は目安であり、正式な判断は税務署・年金事務所・各勤務先の労務担当に確認してください。'
};

/* ======================= Util.js ======================= */

/** 日付・数値まわりの小さなユーティリティ */

function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM-dd');
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM-dd HH:mm:ss');
}

function formatTime_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, 'HH:mm');
}

function formatYearMonth_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, 'yyyy-MM');
}

/**
 * スプレッドシート自身のタイムゾーン。
 * 日付・時刻のセルは「そのスプレッドシートのタイムゾーンでの値」として保存されるため、
 * セルを読むときは CONFIG.timeZone ではなくこちらを使う
 * （ロケールが日本以外のシートで 09:00 が別の時刻にずれるのを防ぐ）。
 */
var SHEET_TIME_ZONE_CACHE = null;
function sheetTimeZone_() {
  if (SHEET_TIME_ZONE_CACHE) return SHEET_TIME_ZONE_CACHE;
  try {
    SHEET_TIME_ZONE_CACHE = getSpreadsheet_().getSpreadsheetTimeZone() || CONFIG.timeZone;
  } catch (e) {
    SHEET_TIME_ZONE_CACHE = CONFIG.timeZone;
  }
  return SHEET_TIME_ZONE_CACHE;
}

/** セルの値を 'yyyy-MM-dd' 文字列へ正規化（Dateセル・文字列セルの両方に対応） */
function toDateString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, sheetTimeZone_(), 'yyyy-MM-dd');
  var s = String(value == null ? '' : value).trim();
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return s;
  return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
}

/** セルの値を 'HH:mm' 文字列へ正規化 */
function toTimeString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, sheetTimeZone_(), 'HH:mm');
  var s = String(value == null ? '' : value).trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return pad2_(m[1]) + ':' + m[2];
}

function pad2_(v) {
  var s = String(v);
  return s.length >= 2 ? s : '0' + s;
}

/** '1,226円' や 1226 を数値へ。数値化できなければ 0 */
function toNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  var s = String(value == null ? '' : value).replace(/[,\s円]/g, '');
  if (s === '') return 0;
  var n = Number(s);
  return isFinite(n) ? n : 0;
}

/** チェックボックス／文字列のどちらでも真偽値にする */
function toBool_(value) {
  if (typeof value === 'boolean') return value;
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === '済' || s === '○';
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

/** 'HH:mm' を0時からの分に変換 */
function hhmmToMinutes_(hhmm) {
  var m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  var h = Number(m[1]);
  var mi = Number(m[2]);
  if (h > 47 || mi > 59) return null;
  return h * 60 + mi;
}

/** 'yyyy-MM-dd' から年を取り出す。取れなければ null */
function yearOfDateString_(dateStr) {
  var m = String(dateStr).match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** 'yyyy-MM-dd' から 'yyyy-MM' を取り出す。取れなければ null */
function yearMonthOfDateString_(dateStr) {
  var m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '-' + m[2] : null;
}

/** 金額表示（例: 1,230,000円） */
function yen_(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

/**
 * スクリプトのタイムゾーンが想定と違うときの警告文（問題なければ null）。
 * ここがずれていると毎日23:30のトリガーが日本時間の別の時刻に動いてしまう。
 */
function timeZoneWarning_() {
  var scriptTz;
  try {
    scriptTz = Session.getScriptTimeZone();
  } catch (e) {
    return null;
  }
  if (!scriptTz || scriptTz === CONFIG.timeZone) return null;
  return (
    'スクリプトのタイムゾーンが ' +
    scriptTz +
    ' になっています。このままだと毎日23:30の自動実行が日本時間の別の時刻に動きます。' +
    'Apps Script の「プロジェクトの設定（Project Settings）→ タイムゾーン（Time zone）」を ' +
    '(GMT+09:00) 東京 / Tokyo に変更してください。'
  );
}

/** 集計対象年 */
function resolveTargetYear_(today) {
  if (CONFIG.targetYear) return CONFIG.targetYear;
  return Number(formatDate_(today).slice(0, 4));
}

/** 'yyyy-MM-dd' を '8/28(金)' の形にする */
function formatShortDate_(dateStr) {
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateStr);
  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  var week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return Number(m[2]) + '/' + Number(m[3]) + '(' + week + ')';
}

/** 'yyyy-MM' の月を n ヶ月進める */
function addMonths_(yearMonth, n) {
  var m = String(yearMonth).match(/^(\d{4})-(\d{2})$/);
  if (!m) return yearMonth;
  var total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return Math.floor(total / 12) + '-' + pad2_((total % 12) + 1);
}

/** 'yyyy-MM-dd' が属する週（月曜始まり）の月曜日を返す */
function weekStartOf_(dateStr) {
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  var offset = (date.getDay() + 6) % 7; // 月曜=0
  date.setDate(date.getDate() - offset);
  return (
    date.getFullYear() + '-' + pad2_(date.getMonth() + 1) + '-' + pad2_(date.getDate())
  );
}

/** 'yyyy-MM-dd' を n 日進める */
function addDays_(dateStr, n) {
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  date.setDate(date.getDate() + n);
  return date.getFullYear() + '-' + pad2_(date.getMonth() + 1) + '-' + pad2_(date.getDate());
}

/* ======================= Sheets.js ======================= */

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
  'updated_at',
  // 後から追加した列。既存シートの並びを崩さないよう末尾に足している
  'allowance',
  'fixed_amount'
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
  '更新日時',
  '手当(円)',
  '支給額(円)'
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

/**
 * 1回の実行の中だけ有効なキャッシュ。
 *
 * Apps Script はシートの読み書き1回ごとに往復が発生し、これが体感速度の大半を占める。
 * 同じ実行の中で同じシートを何度も読み直さないようにするためのもの。
 * Apps Script は実行のたびにスクリプトを読み直すので、実行をまたいで残ることはない。
 * 書き込みを行った表は必ず invalidateTable_ で捨てること。
 */
var SHEET_CACHE = {};
var TABLE_CACHE = {};

/** 表のキャッシュを捨てる（name 省略で全部） */
function invalidateTable_(name) {
  if (name === undefined) TABLE_CACHE = {};
  else delete TABLE_CACHE[name];
}

/** シート取得・表読み込みのキャッシュをまとめて捨てる */
function invalidateSheetCaches_() {
  SHEET_CACHE = {};
  TABLE_CACHE = {};
}

/**
 * 1回の実行の始まりを宣言する。キャッシュを全部捨てて、必ず最新のデータから始める。
 *
 * Apps Script は実行ごとにスクリプトを読み直すので実際はキャッシュも消えているが、
 * 明示しておくことで「キャッシュが実行をまたいで残らない」ことを保証し、
 * テストでも本番と同じ条件で測れるようにする。
 */
function beginExecution_() {
  invalidateSheetCaches_();
  invalidateCalendarCache_();
}

/** シートを取得（無ければヘッダー付きで作成） */
function getSheet_(name) {
  if (SHEET_CACHE[name]) return SHEET_CACHE[name];
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
    invalidateTable_(name);
  }
  SHEET_CACHE[name] = sheet;
  return sheet;
}

/**
 * シートの構成（名前・見出し・初期データ）のバージョン。
 * 列や壁を増やしたらこの値を上げること。次回の実行で移行処理が1度だけ走る。
 */
var SCHEMA_VERSION = '2026-08-29-fixed-amount';

/** スクリプトプロパティ（使えない環境では null） */
function getScriptProperties_() {
  try {
    return PropertiesService.getScriptProperties();
  } catch (e) {
    return null;
  }
}

/**
 * 全シートを用意し、初期データ（設定値）を流し込む。
 *
 * 名前の付け替え・見出しの貼り直し・壁の初期投入は、毎回やると
 * シートの読み書きが十数回増えてアプリの表示が目に見えて遅くなる。
 * 一度済ませたらスクリプトプロパティに記録し、SCHEMA_VERSION が
 * 変わったときだけやり直す。
 *
 * options.force を true にすると記録を無視して必ず全部やり直す
 * （メニューの「① 初期セットアップ」はこちらを使う）。
 */
function ensureSheets_(options) {
  var ss = getSpreadsheet_();
  var props = getScriptProperties_();
  var force = !!(options && options.force);
  var upToDate = !force && props !== null && props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION;

  if (!upToDate) migrateLegacySheetNames_();

  Object.keys(SHEETS).forEach(function (key) {
    getSheet_(SHEETS[key]);
  });

  if (upToDate) return;

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

  if (props) props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
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
      invalidateTable_(name);
    }
  });
}

/**
 * CONFIG.walls.thresholds にあって、まだ「壁の設定」シートに無い壁だけを追加する。
 * 名前（例: '150万円'）で照合するので、既にシート上で編集済みの行には触らない。
 * これにより、後から壁の種類が増えたときも初期セットアップの再実行だけで反映できる。
 */
function seedWallThresholds_() {
  var existing = {};
  readTable_(SHEETS.WALLS).rows.forEach(function (r) {
    existing[String(r.name).trim()] = r;
  });
  var missing = CONFIG.walls.thresholds.filter(function (w) {
    return !existing[w.name];
  });
  if (missing.length === 0) return;

  // 制度が変わって置き換わった古い壁は、新しい壁を足すときに取り除く。
  // 新しい壁が既にある場合は何もしないので、あとから自分で足した行は消えない。
  var sheet = getSheet_(SHEETS.WALLS);
  var removeRowIndexes = [];
  missing.forEach(function (w) {
    (w.replaces || []).forEach(function (oldName) {
      var row = existing[String(oldName).trim()];
      if (row && removeRowIndexes.indexOf(row._rowIndex) < 0) removeRowIndexes.push(row._rowIndex);
    });
  });
  removeRowIndexes
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (rowIndex) {
      sheet.deleteRow(rowIndex);
    });
  if (removeRowIndexes.length > 0) invalidateTable_(SHEETS.WALLS);

  var rows = missing.map(function (w) {
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
  if (TABLE_CACHE[name]) return TABLE_CACHE[name];
  var sheet = getSheet_(name);
  var headers = SCHEMA[name] || [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    TABLE_CACHE[name] = { headers: headers, rows: [] };
    return TABLE_CACHE[name];
  }
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
  TABLE_CACHE[name] = { headers: headers, rows: rows };
  return TABLE_CACHE[name];
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
  invalidateTable_(name);
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
  if (updated > 0 || toAppend.length > 0) invalidateTable_(name);
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
  invalidateTable_(name);
}

/** 実行ログに1行追記（直近500件だけ残す） */
function writeLog_(kind, level, message) {
  var sheet = getSheet_(SHEETS.LOG);
  sheet.appendRow([formatDateTime_(new Date()), kind, level, message]);
  var lastRow = sheet.getLastRow();
  if (lastRow > 501) sheet.deleteRows(2, lastRow - 501);
  invalidateTable_(SHEETS.LOG);
}

/* ======================= Parser.js ======================= */

/**
 * カレンダー予定タイトルの解析
 *
 * 想定フォーマット:
 *   [会社名] 開始時刻-終了時刻 休憩Xh 時給Y円
 *   例) [Kakedas] 09:00-18:00 休憩1h 時給1226円
 *   例) [バイトレ] 13:00-17:00 休憩なし 時給1700円
 *
 * ・会社名は [ ] で囲む（勤務予定の目印。無い予定は勤務以外とみなして無視する）
 * ・休憩が無い場合は「休憩なし」と明記する
 * ・時給は末尾に「円」付き
 */

/** 全角→半角などの表記ゆれを吸収する */
function normalizeTitle_(rawTitle) {
  var s = String(rawTitle == null ? '' : rawTitle);
  if (s.normalize) s = s.normalize('NFKC');
  return s.replace(/[　\s]+/g, ' ').trim();
}

/**
 * タイトルを解析する。
 * 戻り値: {
 *   ok, kind: 'work'|'skip'|'error', reason, warnings[],
 *   companyName, startTime, endTime, hasTimeRange, breakHours, hourlyWage, normalizedTitle
 * }
 */
function parseWorkEventTitle_(rawTitle) {
  var title = normalizeTitle_(rawTitle);
  var res = {
    ok: false,
    kind: 'skip',
    reason: '',
    warnings: [],
    companyName: '',
    startTime: '',
    endTime: '',
    hasTimeRange: false,
    breakHours: 0,
    hourlyWage: 0,
    allowance: 0,
    hasFixedAmount: false,
    fixedAmount: 0,
    normalizedTitle: title
  };

  var company = title.match(/[[［]\s*([^\]］]+?)\s*[\]］]/);
  if (!company) {
    res.reason = '会社名の [ ] が無いため勤務予定として扱いません';
    return res;
  }
  res.companyName = company[1];
  // [ ] がある＝勤務予定のつもり。ここから先の不備はフォーマット誤りとして報告する
  res.kind = 'error';

  // 区切り文字は各種ダッシュ・波ダッシュ・全角マイナスに対応する
  var range = title.match(
    /(\d{1,2}:\d{2})\s*(?:[-\u2010-\u2015\u2212\uFF0D~\u301C\u3030\uFF5E\u30FC]|to)\s*(\d{1,2}:\d{2})/i
  );
  if (range) {
    res.startTime = toTimeString_(range[1]);
    res.endTime = toTimeString_(range[2]);
    res.hasTimeRange = true;
    if (hhmmToMinutes_(res.startTime) === null || hhmmToMinutes_(res.endTime) === null) {
      res.reason = '時刻が不正です: ' + range[0];
      return res;
    }
  }

  var brk = parseBreakHours_(title);
  if (!brk.found) {
    res.warnings.push('休憩の記載がありません（休憩0hとして計算しました）。「休憩なし」または「休憩1h」と書いてください');
  }
  res.breakHours = brk.hours;

  var wage = title.match(/時給\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円/);
  if (!wage) {
    var wageNoYen = title.match(/時給\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    if (!wageNoYen) {
      res.reason = '時給の記載が見つかりません（例: 時給1226円）';
      return res;
    }
    wage = wageNoYen;
    res.warnings.push('時給に「円」がありません（例: 時給1226円）');
  }
  res.hourlyWage = toNumber_(wage[1]);
  if (res.hourlyWage <= 0) {
    res.reason = '時給が0円以下です';
    return res;
  }

  res.allowance = parseAllowance_(title);

  var fixed = parseFixedAmount_(title);
  if (fixed.found) {
    res.hasFixedAmount = true;
    res.fixedAmount = fixed.amount;
    if (res.allowance > 0) {
      res.warnings.push(
        '支給額を書いたので、その日の金額は支給額そのものにしました（手当は足していません）。' +
          '手当も受け取るなら、支給額に足した金額を書いてください'
      );
      res.allowance = 0;
    }
  }

  res.ok = true;
  res.kind = 'work';
  res.reason = '';
  return res;
}

/**
 * 手当（時給とは別に、その勤務1回につき出る固定額）を読み取る。
 *
 * 単発バイトでは就業先ごとに交通費・食事補助などが出るため、時給とは
 * 別建てで合算できるようにしている。複数書いてあれば全部足す。
 *
 * 対応: 手当1000円 / 交通費500円 / 手当+1000円 / 食事手当500円 など
 * 「手当なし」と書いた場合は0。
 */
function parseAllowance_(title) {
  if (/(?:手当|交通費)\s*(?:なし|ナシ|無し)/.test(title)) return 0;

  var total = 0;
  // 「〇〇手当」「交通費」「日当」に続く金額を全部拾う
  var pattern = /(?:[^\s\d]{0,4}手当|交通費|日当)\s*\+?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円?/g;
  var match;
  while ((match = pattern.exec(title)) !== null) {
    total += toNumber_(match[1]);
  }
  return total;
}

/**
 * その日の支給額（時給×時間の計算を上書きする、確定した金額）を読み取る。
 *
 * 残業がついた・特別手当が出た・端数の扱いが会社独自、といった理由で
 * 時給×時間と実際の支給額がずれる日のためのもの。書いてあればそれが優先される。
 *
 * 対応: 支給18500円 / 支給額18,500円 / 給与18500円 / 合計18500円
 */
function parseFixedAmount_(title) {
  var match = title.match(/(?:支給額|支給|給与|合計)\s*\+?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円?/);
  if (!match) return { found: false, amount: 0 };
  var amount = toNumber_(match[1]);
  if (amount <= 0) return { found: false, amount: 0 };
  return { found: true, amount: Math.round(amount) };
}

/**
 * 休憩時間の表記を時間(小数)に変換する。
 * 対応: 休憩なし / 休憩無し / 休憩1h / 休憩1.5h / 休憩1時間 / 休憩1時間30分 / 休憩90分
 */
function parseBreakHours_(title) {
  if (/休憩\s*(?:なし|ナシ|無し|0\s*(?:h|時間|分)?)(?![0-9.])/i.test(title)) {
    return { found: true, hours: 0 };
  }
  var hm = title.match(/休憩\s*(\d+(?:\.\d+)?)\s*(?:h|時間)\s*(?:(\d+)\s*(?:m|分))?/i);
  if (hm) {
    var hours = Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
    return { found: true, hours: hours };
  }
  var mm = title.match(/休憩\s*(\d+)\s*(?:m|min|分)/i);
  if (mm) return { found: true, hours: Number(mm[1]) / 60 };
  return { found: false, hours: 0 };
}

/* ======================= Calc.js ======================= */

/**
 * 計算ロジック
 *
 * 金額はすべて額面（源泉徴収前の総支給額）で扱う。
 * 源泉徴収された分は確定申告で還付される前払いに過ぎず、
 * 監視対象は「壁の基準を満たすかどうか」であって手元に残る金額ではないため。
 */

/**
 * 実働時間 = (終了時刻 - 開始時刻) - 休憩時間
 * 終了時刻が開始時刻より小さい場合は日をまたいだ勤務とみなす。
 */
function computeWorkedHours_(startTime, endTime, breakHours) {
  var start = hhmmToMinutes_(startTime);
  var end = hhmmToMinutes_(endTime);
  if (start === null || end === null) return null;
  if (end < start) end += 24 * 60;
  var net = end - start - Math.round(Number(breakHours || 0) * 60);
  if (net <= 0) return 0;
  return net / 60;
}

/**
 * その日の推定収入（額面） = 実働時間 × 時給 ＋ 手当。円未満は四捨五入。
 *
 * 手当は単発バイトで就業先ごとに出る固定額（交通費・食事補助など）。
 * 額面に含まれるものとして時給分に足す。
 *
 * fixedAmount（その日の支給額）が指定されていれば、計算結果ではなくそちらを使う。
 * 残業や会社独自の端数処理で、時給×時間と実際の支給額がずれる日のため。
 */
function computeEstimatedAmount_(workedHours, hourlyWage, allowance, fixedAmount) {
  // その日の支給額が分かっている場合（残業がついた日など）は、それをそのまま使う
  var fixed = Number(fixedAmount || 0);
  if (fixed > 0) return Math.round(fixed);
  var base = Math.round(Number(workedHours || 0) * Number(hourlyWage || 0));
  return base + Math.round(Number(allowance || 0));
}

/** 給与所得控除（CONFIG.salaryDeduction の表に従う） */
function computeSalaryDeduction_(salaryRevenue) {
  var revenue = Number(salaryRevenue || 0);
  if (revenue <= 0) return 0;
  var conf = CONFIG.salaryDeduction;
  var bracket = null;
  for (var i = 0; i < conf.brackets.length; i++) {
    var b = conf.brackets[i];
    if (b.upTo === null || revenue <= b.upTo) {
      bracket = b;
      break;
    }
  }
  if (!bracket) bracket = conf.brackets[conf.brackets.length - 1];
  var deduction = revenue * bracket.rate + bracket.plus;
  deduction = Math.max(deduction, conf.minimum);
  return Math.min(deduction, revenue);
}

/**
 * 年間の収入・所得を集計する。
 * 給与所得分（カレンダー由来 + 手入力の給与所得）と事業所得分・雑所得分を分けて管理する。
 */
function aggregateAnnual_(calendarRows, manualRows, targetYear) {
  var salaryRevenue = 0;
  var calendarRevenue = 0;
  var allowanceTotal = 0;
  var manualSalaryRevenue = 0;
  var business = { revenue: 0, expenses: 0 };
  var misc = { revenue: 0, expenses: 0 };
  var warnings = [];

  calendarRows.forEach(function (r) {
    var year = yearOfDateString_(toDateString_(r.date));
    if (year !== targetYear) return;
    calendarRevenue += toNumber_(r.estimated_amount);
    allowanceTotal += toNumber_(r.allowance);
  });

  manualRows.forEach(function (r) {
    var period = String(r.period == null ? '' : r.period);
    var year = yearOfDateString_(period);
    if (year === null) {
      warnings.push(
        '手入力収入「' + r.source_name + '」の period に年が読み取れません（' + period + '）。集計から除外しました'
      );
      return;
    }
    if (year !== targetYear) return;
    var amount = toNumber_(r.amount);
    var expenses = toNumber_(r.expenses);
    var category = String(r.income_category || '').trim();
    if (category === INCOME_CATEGORY.BUSINESS) {
      business.revenue += amount;
      business.expenses += expenses;
    } else if (category === INCOME_CATEGORY.MISC) {
      misc.revenue += amount;
      misc.expenses += expenses;
    } else {
      manualSalaryRevenue += amount;
      if (category !== INCOME_CATEGORY.SALARY) {
        warnings.push(
          '手入力収入「' + r.source_name + '」の income_category が不明（' + category + '）のため給与所得として集計しました'
        );
      }
    }
  });

  salaryRevenue = calendarRevenue + manualSalaryRevenue;
  var salaryDeduction = computeSalaryDeduction_(salaryRevenue);
  var salaryIncome = Math.max(0, salaryRevenue - salaryDeduction);
  var businessIncome = Math.max(0, business.revenue - business.expenses);
  var miscIncome = Math.max(0, misc.revenue - misc.expenses);

  return {
    targetYear: targetYear,
    calendarRevenue: calendarRevenue,
    allowanceTotal: allowanceTotal,
    manualSalaryRevenue: manualSalaryRevenue,
    salaryRevenue: salaryRevenue,
    businessRevenue: business.revenue,
    businessExpenses: business.expenses,
    miscRevenue: misc.revenue,
    miscExpenses: misc.expenses,
    /** 壁の判定に使う年間収入合計（額面） */
    totalRevenue: salaryRevenue + business.revenue + misc.revenue,
    salaryDeduction: salaryDeduction,
    salaryIncome: salaryIncome,
    businessIncome: businessIncome,
    miscIncome: miscIncome,
    /** 収入額そのものとは別の数値。税金の壁の判定に使う */
    totalIncome: salaryIncome + businessIncome + miscIncome,
    warnings: warnings
  };
}

/** 壁までの残りを計算する */
function evaluateWalls_(wallRows, totalRevenue, targetYear) {
  return wallRows
    .filter(function (w) {
      var year = toNumber_(w.applicable_year);
      return !year || year === targetYear;
    })
    .map(function (w) {
      var amount = toNumber_(w.amount);
      var remaining = amount - totalRevenue;
      var ratio = amount > 0 ? totalRevenue / amount : 0;
      var status = '正常';
      if (remaining < 0) status = '警告';
      else if (ratio >= CONFIG.walls.warnRatio) status = '注意';
      return {
        name: String(w.name),
        amount: amount,
        applicableYear: toNumber_(w.applicable_year),
        lastUpdated: toDateString_(w.last_updated),
        note: String(w.note || ''),
        remaining: remaining,
        ratio: ratio,
        status: status
      };
    });
}

/**
 * 会社ごとの当月実働時間を集計し、暫定上限（既定120時間）と比較する。
 * 80%で「注意」、100%で「警告」。
 */
function aggregateMonthlyHours_(calendarRows, limitRows, yearMonth) {
  var limits = readCompanyLimits_(limitRows);

  var byCompany = {};
  calendarRows.forEach(function (r) {
    if (yearMonthOfDateString_(toDateString_(r.date)) !== yearMonth) return;
    var name = String(r.company_name || '').trim();
    if (!name) return;
    if (!byCompany[name]) byCompany[name] = { hours: 0, amount: 0, days: 0 };
    byCompany[name].hours += toNumber_(r.worked_hours);
    byCompany[name].amount += toNumber_(r.estimated_amount);
    byCompany[name].days += 1;
  });

  return Object.keys(byCompany)
    .sort()
    .map(function (name) {
      var limitInfo = limits[name] || defaultCompanyLimit_();
      var hours = round2_(byCompany[name].hours);
      var ratio = limitInfo.limit > 0 ? hours / limitInfo.limit : 0;
      var status = '正常';
      if (ratio >= CONFIG.hours.alertRatio) status = '警告';
      else if (ratio >= CONFIG.hours.warnRatio) status = '注意';
      return {
        companyName: name,
        yearMonth: yearMonth,
        hours: hours,
        amount: byCompany[name].amount,
        days: byCompany[name].days,
        limit: limitInfo.limit,
        confirmed: limitInfo.confirmed,
        basis: limitInfo.basis,
        ratio: ratio,
        status: status
      };
    });
}

/** 勤務先ごとの上限設定を読む */
function readCompanyLimits_(limitRows) {
  var limits = {};
  (limitRows || []).forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (!name) return;
    limits[name] = {
      limit: toNumber_(r.monthly_hour_limit) || CONFIG.hours.defaultMonthlyLimit,
      weeklyLimit: toNumber_(r.weekly_hour_limit),
      consecutiveMonths: toNumber_(r.consecutive_months) || 1,
      confirmed: toBool_(r.confirmed),
      basis: String(r.basis || '')
    };
  });
  return limits;
}

function defaultCompanyLimit_() {
  return {
    limit: CONFIG.hours.defaultMonthlyLimit,
    weeklyLimit: 0,
    consecutiveMonths: 1,
    confirmed: false,
    basis: ''
  };
}

function statusForRatio_(ratio) {
  if (ratio >= CONFIG.hours.alertRatio) return '警告';
  if (ratio >= CONFIG.hours.warnRatio) return '注意';
  return '正常';
}

/**
 * 週の上限がある勤務先について、直近の週ごとの実働時間を集計する。
 * 「正社員の週所定労働時間の4分の3」のように週単位で基準が示された場合に使う。
 */
function aggregateWeeklyHours_(calendarRows, limitRows, today, weeks) {
  var limits = readCompanyLimits_(limitRows);
  var targets = Object.keys(limits).filter(function (name) {
    return limits[name].weeklyLimit > 0;
  });
  if (targets.length === 0) return [];

  var count = weeks || 4;
  var thisWeek = weekStartOf_(formatDate_(today));
  var windowStart = addDays_(thisWeek, -7 * (count - 1));

  var byKey = {};
  calendarRows.forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (!limits[name] || limits[name].weeklyLimit <= 0) return;
    var date = toDateString_(r.date);
    var weekStart = weekStartOf_(date);
    if (!weekStart || weekStart < windowStart || weekStart > thisWeek) return;
    var key = name + '\t' + weekStart;
    byKey[key] = (byKey[key] || 0) + toNumber_(r.worked_hours);
  });

  var result = [];
  targets.sort().forEach(function (name) {
    for (var i = count - 1; i >= 0; i--) {
      var weekStart = addDays_(thisWeek, -7 * i);
      var hours = round2_(byKey[name + '\t' + weekStart] || 0);
      var limit = limits[name].weeklyLimit;
      var ratio = limit > 0 ? hours / limit : 0;
      result.push({
        companyName: name,
        weekStart: weekStart,
        weekEnd: addDays_(weekStart, 6),
        isCurrentWeek: weekStart === thisWeek,
        hours: hours,
        limit: limit,
        confirmed: limits[name].confirmed,
        ratio: ratio,
        status: statusForRatio_(ratio),
        remainingHours: round2_(Math.max(0, limit - hours))
      });
    }
  });
  return result;
}

/**
 * 「月◯時間以上が◯ヶ月連続」という条件の勤務先を判定する。
 * 連続月数が1の勤務先（単月判定）は対象外。
 */
function evaluateConsecutiveMonths_(calendarRows, limitRows, today, extraHours) {
  var limits = readCompanyLimits_(limitRows);
  var currentMonth = formatYearMonth_(today);

  var monthly = {};
  calendarRows.forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (!name) return;
    var ym = yearMonthOfDateString_(toDateString_(r.date));
    if (!ym) return;
    monthly[name + '\t' + ym] = (monthly[name + '\t' + ym] || 0) + toNumber_(r.worked_hours);
  });
  // 見込みで判定したいときに、これからの予定分を足し込む
  Object.keys(extraHours || {}).forEach(function (key) {
    monthly[key] = (monthly[key] || 0) + toNumber_(extraHours[key]);
  });

  var result = [];
  Object.keys(limits)
    .sort()
    .forEach(function (name) {
      var info = limits[name];
      if (info.consecutiveMonths < 2) return;

      var months = [];
      for (var i = info.consecutiveMonths - 1; i >= 0; i--) {
        var ym = addMonths_(currentMonth, -i);
        var hours = round2_(monthly[name + '\t' + ym] || 0);
        months.push({
          yearMonth: ym,
          hours: hours,
          isCurrentMonth: ym === currentMonth,
          over: hours >= info.limit
        });
      }

      var past = months.slice(0, months.length - 1);
      var current = months[months.length - 1];
      var pastAllOver = past.length > 0 && past.every(function (m) {
        return m.over;
      });

      var status = '正常';
      var message = '';
      if (pastAllOver && current.over) {
        status = '警告';
        message =
          name + ' は ' + info.consecutiveMonths + 'ヶ月連続で月' + info.limit + '時間以上になっています（' +
          months.map(function (m) {
            return m.yearMonth + ' ' + m.hours + 'h';
          }).join(' / ') + '）。勤務先に相談してください。';
      } else if (pastAllOver) {
        status = '注意';
        message =
          '先月まで ' + past.length + 'ヶ月連続で月' + info.limit + '時間以上です。' +
          name + ' の今月は ' + current.hours + '時間。あと ' + round2_(Math.max(0, info.limit - current.hours)) +
          '時間で' + info.consecutiveMonths + 'ヶ月連続になるので、今月は' + info.limit + '時間未満に抑えてください。';
      }

      result.push({
        companyName: name,
        limit: info.limit,
        requiredMonths: info.consecutiveMonths,
        months: months,
        status: status,
        message: message,
        basis: info.basis
      });
    });
  return result;
}

/** 月次の答え合わせ（給与明細の実額 vs カレンダー推定額）の判定 */
function evaluateReconciliation_(estimatedAmount, actualAmount) {
  var diff = Number(actualAmount) - Number(estimatedAmount);
  var rate = Number(estimatedAmount) > 0 ? diff / Number(estimatedAmount) : 0;
  var overRate = Math.abs(rate) > CONFIG.reconcile.toleranceRate;
  var overAmount = Math.abs(diff) > CONFIG.reconcile.toleranceAmount;
  return {
    diff: diff,
    rate: rate,
    status: overRate && overAmount ? '要確認' : 'OK'
  };
}

/* ======================= CalendarSource.js ======================= */

/** Google カレンダーから、その日（0:00〜23:59）の勤務予定を取り出す */

/**
 * 1回の実行の中だけ有効なカレンダーのキャッシュ。
 * カレンダーの取得も予定の読み込みも1回ごとに往復が発生するため、
 * 同じ実行の中では取得済みの結果を使い回す。
 */
var CALENDAR_SOURCES_CACHE = null;
var CALENDAR_EVENTS_CACHE = {};

/** カレンダー関連のキャッシュを捨てる */
function invalidateCalendarCache_() {
  CALENDAR_SOURCES_CACHE = null;
  CALENDAR_EVENTS_CACHE = {};
}

/**
 * CONFIG.calendarIds に列挙された全カレンダーを解決する。
 * 見つからない/読めないカレンダーはエラーを添えて返す（他のカレンダーの取り込みは止めない）。
 */
function getTargetCalendars_() {
  if (CALENDAR_SOURCES_CACHE) return CALENDAR_SOURCES_CACHE;
  var ids = CONFIG.calendarIds && CONFIG.calendarIds.length ? CONFIG.calendarIds : ['primary'];
  var resolved = ids.map(function (rawId) {
    var key = String(rawId || 'primary').trim() || 'primary';
    var calendar = null;
    var error = null;
    try {
      calendar = key === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(key);
      if (!calendar) {
        error = 'カレンダー「' + key + '」が見つかりません。共有されているか確認してください';
      }
    } catch (e) {
      error = 'カレンダー「' + key + '」を読み込めませんでした: ' + e.message;
    }
    return { key: key, calendar: calendar, error: error };
  });
  CALENDAR_SOURCES_CACHE = resolved;
  return resolved;
}

/**
 * 予定を取得する。すでに取得済みの範囲に収まっていれば、その結果から絞り込んで返す。
 *
 * アプリを開くと「過去1ヶ月の取り込み」と「先1ヶ月の見込み」で2回カレンダーを
 * 読むことになるが、prefetchCalendar_ で両方を含む範囲を先に1回読んでおけば、
 * 実際のカレンダー取得は1回で済む。
 */
function getCalendarEvents_(source, startDate, endDate) {
  var cached = CALENDAR_EVENTS_CACHE[source.key];
  if (cached && cached.from <= startDate.getTime() && cached.to >= endDate.getTime()) {
    return cached.events.filter(function (event) {
      var t = event.getStartTime().getTime();
      return t >= startDate.getTime() && t < endDate.getTime();
    });
  }
  var events = source.calendar.getEvents(startDate, endDate);
  CALENDAR_EVENTS_CACHE[source.key] = {
    from: startDate.getTime(),
    to: endDate.getTime(),
    events: events
  };
  return events;
}

/**
 * これから必要になる期間をまとめて1回だけ読んでおく。
 * 取り込み（過去）と見込み（未来）の両方を含む範囲を一度に取る。
 */
function prefetchCalendar_(today) {
  var from = new Date(today.getTime());
  from.setDate(from.getDate() - Math.max(0, CONFIG.app.autoImportDays - 1));
  from.setHours(0, 0, 0, 0);
  var to = new Date(today.getTime());
  to.setDate(to.getDate() + CONFIG.forecast.lookaheadDays + 1);
  to.setHours(0, 0, 0, 0);

  getTargetCalendars_().forEach(function (source) {
    if (!source.calendar) return;
    try {
      getCalendarEvents_(source, from, to);
    } catch (e) {
      // ここでの失敗は後続の取得時に改めて報告されるので、黙って進める
    }
  });
}

/**
 * 勤務明細の行IDに使う接頭辞。
 * 既定カレンダー（primary）は既存データとの互換のため接頭辞を付けない。
 * 追加したカレンダーはキーを接頭辞にして、他カレンダーの同名予定と衝突しないようにする。
 */
function calendarIdPrefix_(key) {
  return key === 'primary' ? '' : key + ':';
}

/**
 * 指定日の予定を解析して勤務データにする。
 * 戻り値: { dateStr, entries[], skipped, errors[], warnings[] }
 */
function fetchWorkEntriesForDate_(date) {
  var start = new Date(date.getTime());
  start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  var result = fetchWorkEntriesInRange_(start, end);
  result.dateStr = formatDate_(start);
  return result;
}

/**
 * 期間内の予定を、CONFIG.calendarIds の全カレンダーから取得して勤務データにする。
 * 戻り値: { entries[], skipped, errors[], warnings[] }
 */
function fetchWorkEntriesInRange_(startDate, endDate) {
  var result = { entries: [], skipped: 0, errors: [], warnings: [] };
  var now = formatDateTime_(new Date());

  getTargetCalendars_().forEach(function (source) {
    if (!source.calendar) {
      if (source.error) result.errors.push(source.error);
      return;
    }

    var events;
    try {
      events = getCalendarEvents_(source, startDate, endDate);
    } catch (e) {
      result.errors.push('カレンダー「' + source.key + '」の予定を読めませんでした: ' + e.message);
      return;
    }
    var idPrefix = calendarIdPrefix_(source.key);

    events.forEach(function (event) {
      var dateStr = formatDate_(event.getStartTime());
      var title = event.getTitle();
      var parsed = parseWorkEventTitle_(title);

      if (parsed.kind === 'skip') {
        result.skipped++;
        return;
      }
      if (parsed.kind === 'error') {
        result.errors.push(dateStr + ' 「' + title + '」: ' + parsed.reason);
        return;
      }

      var startTime = parsed.startTime;
      var endTime = parsed.endTime;
      if (!parsed.hasTimeRange) {
        if (event.isAllDayEvent()) {
          result.errors.push(
            dateStr + ' 「' + title + '」: 終日予定でタイトルにも時刻がありません（例: 09:00-18:00）'
          );
          return;
        }
        // タイトルに時刻を書かず、カレンダーの予定時刻をそのまま使う書き方も正式に対応する
        startTime = formatTime_(event.getStartTime());
        endTime = formatTime_(event.getEndTime());
      }

      var workedHours = computeWorkedHours_(startTime, endTime, parsed.breakHours);
      if (workedHours === null) {
        result.errors.push(dateStr + ' 「' + title + '」: 実働時間を計算できませんでした');
        return;
      }
      if (workedHours === 0) {
        result.warnings.push(dateStr + ' 「' + title + '」: 実働時間が0時間になりました（休憩時間の記載を確認してください）');
      }

      parsed.warnings.forEach(function (w) {
        result.warnings.push(dateStr + ' 「' + title + '」: ' + w);
      });

      result.entries.push({
        // 繰り返し予定は getId() が全回で同じになるため、日付を足して一意にする
        id: idPrefix + event.getId() + '#' + dateStr,
        date: dateStr,
        company_name: parsed.companyName,
        start_time: startTime,
        end_time: endTime,
        break_hours: round2_(parsed.breakHours),
        worked_hours: round2_(workedHours),
        hourly_wage: parsed.hourlyWage,
        estimated_amount: computeEstimatedAmount_(
          workedHours,
          parsed.hourlyWage,
          parsed.allowance,
          parsed.fixedAmount
        ),
        reconciled: false,
        source_title: title,
        updated_at: now,
        allowance: parsed.allowance,
        fixed_amount: parsed.hasFixedAmount ? parsed.fixedAmount : 0
      });
    });
  });

  return result;
}

/**
 * 期間内の予定を、CONFIG.calendarIds の全カレンダーからまとめて取得し、勤務予定だけを解析して返す。
 * シートには書き込まない（先読み用）。
 */
function fetchPlannedShifts_(startDate, endDate) {
  var result = { entries: [], skipped: 0, errors: [] };

  getTargetCalendars_().forEach(function (source) {
    if (!source.calendar) {
      if (source.error) result.errors.push(source.error);
      return;
    }

    var events;
    try {
      events = getCalendarEvents_(source, startDate, endDate);
    } catch (e) {
      result.errors.push('カレンダー「' + source.key + '」の予定を読めませんでした: ' + e.message);
      return;
    }

    events.forEach(function (event) {
      var title = event.getTitle();
      var parsed = parseWorkEventTitle_(title);
      if (parsed.kind === 'skip') {
        result.skipped++;
        return;
      }
      var dateStr = formatDate_(event.getStartTime());
      if (parsed.kind === 'error') {
        result.errors.push(dateStr + ' 「' + title + '」: ' + parsed.reason);
        return;
      }

      var startTime = parsed.startTime;
      var endTime = parsed.endTime;
      if (!parsed.hasTimeRange) {
        if (event.isAllDayEvent()) {
          result.errors.push(dateStr + ' 「' + title + '」: 終日予定でタイトルにも時刻がありません');
          return;
        }
        startTime = formatTime_(event.getStartTime());
        endTime = formatTime_(event.getEndTime());
      }

      var workedHours = computeWorkedHours_(startTime, endTime, parsed.breakHours);
      if (workedHours === null || workedHours === 0) return;

      result.entries.push({
        date: dateStr,
        company_name: parsed.companyName,
        start_time: startTime,
        end_time: endTime,
        worked_hours: round2_(workedHours),
        hourly_wage: parsed.hourlyWage,
        allowance: parsed.allowance,
        fixed_amount: parsed.hasFixedAmount ? parsed.fixedAmount : 0,
        estimated_amount: computeEstimatedAmount_(
          workedHours,
          parsed.hourlyWage,
          parsed.allowance,
          parsed.fixedAmount
        )
      });
    });
  });

  result.entries.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  return result;
}

/* ======================= Forecast.js ======================= */

/**
 * この先の見込みと、勤務調整のアドバイス
 *
 * カレンダーに入っている「これからの予定」を先読みして、
 *   ・このまま働くと月間労働時間が上限を超えないか
 *   ・このまま働くと年収の壁を超えないか
 * を判定し、超えるなら「どのシフトを何件外せば収まるか」まで出す。
 *
 * 先読みした予定は勤務明細には書き込まない（実績と見込みを混ぜないため）。
 */

/** 先読みしてアドバイスまで作る */
function buildForecast_(calendarRows, limitRows, walls, annual, today) {
  var start = new Date(today.getTime());
  start.setHours(0, 0, 0, 0);
  var end = new Date(start.getTime());
  end.setDate(end.getDate() + CONFIG.forecast.lookaheadDays);

  var fetched;
  try {
    fetched = fetchPlannedShifts_(start, end);
  } catch (e) {
    return { available: false, reason: 'カレンダーを読めませんでした: ' + e.message, advice: [] };
  }

  // 既に勤務明細にある勤務は「実績」なので、予定から除いて二重計上を防ぐ
  var recorded = {};
  calendarRows.forEach(function (r) {
    recorded[shiftKey_(r.date, r.company_name, r.start_time)] = true;
  });
  var planned = fetched.entries.filter(function (e) {
    return !recorded[shiftKey_(e.date, e.company_name, e.start_time)];
  });

  var forecast = {
    available: true,
    from: formatDate_(start),
    to: formatDate_(new Date(end.getTime() - 24 * 60 * 60 * 1000)),
    days: CONFIG.forecast.lookaheadDays,
    plannedCount: planned.length,
    plannedHours: round2_(sumBy_(planned, 'worked_hours')),
    plannedRevenue: sumBy_(planned, 'estimated_amount'),
    errors: fetched.errors,
    months: forecastMonths_(calendarRows, planned, limitRows, today),
    consecutive: forecastConsecutive_(calendarRows, planned, limitRows, today),
    walls: forecastWalls_(walls, annual, planned),
    pace: forecastPace_(calendarRows, annual, walls, today),
    averageWage: averageHourlyWage_(planned.length > 0 ? planned : calendarRows)
  };
  forecast.advice = buildAdvice_(forecast, planned);
  return forecast;
}

function sumBy_(rows, field) {
  var total = 0;
  rows.forEach(function (r) {
    total += toNumber_(r[field]);
  });
  return total;
}

/** 実働時間で重みづけした平均時給 */
function averageHourlyWage_(rows) {
  var hours = 0;
  var amount = 0;
  rows.forEach(function (r) {
    hours += toNumber_(r.worked_hours);
    amount += toNumber_(r.estimated_amount);
  });
  return hours > 0 ? Math.round(amount / hours) : 0;
}

/** 会社×月ごとの「実績＋予定＝見込み」 */
function forecastMonths_(calendarRows, planned, limitRows, today) {
  var limits = readCompanyLimits_(limitRows);

  var currentMonth = formatYearMonth_(today);
  var scope = {};
  planned.forEach(function (e) {
    var ym = yearMonthOfDateString_(e.date);
    if (!ym) return;
    scope[ym + '\t' + e.company_name] = true;
  });
  // 予定が無くても、当月に実績がある会社は見込みを出す
  calendarRows.forEach(function (r) {
    var ym = yearMonthOfDateString_(toDateString_(r.date));
    if (ym !== currentMonth) return;
    scope[ym + '\t' + String(r.company_name).trim()] = true;
  });

  return Object.keys(scope)
    .sort()
    .map(function (key) {
      var parts = key.split('\t');
      var yearMonth = parts[0];
      var companyName = parts[1];

      var actualHours = 0;
      calendarRows.forEach(function (r) {
        if (yearMonthOfDateString_(toDateString_(r.date)) !== yearMonth) return;
        if (String(r.company_name).trim() !== companyName) return;
        actualHours += toNumber_(r.worked_hours);
      });

      var plannedShifts = planned.filter(function (e) {
        return yearMonthOfDateString_(e.date) === yearMonth && e.company_name === companyName;
      });
      var plannedHours = sumBy_(plannedShifts, 'worked_hours');
      var info = limits[companyName] || defaultCompanyLimit_();
      var projected = round2_(actualHours + plannedHours);
      var ratio = info.limit > 0 ? projected / info.limit : 0;
      var status = '正常';
      if (ratio >= CONFIG.hours.alertRatio) status = '警告';
      else if (ratio >= CONFIG.hours.warnRatio) status = '注意';

      return {
        yearMonth: yearMonth,
        companyName: companyName,
        actualHours: round2_(actualHours),
        plannedHours: round2_(plannedHours),
        projectedHours: projected,
        limit: info.limit,
        confirmed: info.confirmed,
        ratio: ratio,
        status: status,
        overHours: round2_(Math.max(0, projected - info.limit)),
        remainingHours: round2_(Math.max(0, info.limit - projected)),
        plannedShifts: plannedShifts
      };
    });
}

/** これからの予定も含めた「連続月」の見込み */
function forecastConsecutive_(calendarRows, planned, limitRows, today) {
  var extra = {};
  planned.forEach(function (e) {
    var ym = yearMonthOfDateString_(e.date);
    if (!ym) return;
    var key = e.company_name + '\t' + ym;
    extra[key] = (extra[key] || 0) + toNumber_(e.worked_hours);
  });
  return evaluateConsecutiveMonths_(calendarRows, limitRows, today, extra);
}

/** 予定を全部こなした場合の壁の状況 */
function forecastWalls_(walls, annual, planned) {
  var plannedRevenue = sumBy_(planned, 'estimated_amount');
  var projected = annual.totalRevenue + plannedRevenue;
  return walls.map(function (w) {
    var remaining = w.amount - projected;
    var ratio = w.amount > 0 ? projected / w.amount : 0;
    var status = '正常';
    if (remaining < 0) status = '警告';
    else if (ratio >= CONFIG.walls.warnRatio) status = '注意';
    return {
      name: w.name,
      amount: w.amount,
      projectedRevenue: projected,
      remaining: remaining,
      ratio: ratio,
      status: status
    };
  });
}

/** 直近の平均月収から年末の着地を見積もる（あくまで目安） */
function forecastPace_(calendarRows, annual, walls, today) {
  var currentMonth = formatYearMonth_(today);
  var monthlyTotals = {};
  calendarRows.forEach(function (r) {
    var ym = yearMonthOfDateString_(toDateString_(r.date));
    if (!ym) return;
    monthlyTotals[ym] = (monthlyTotals[ym] || 0) + toNumber_(r.estimated_amount);
  });

  // 当月は途中なので平均から除く
  var completed = Object.keys(monthlyTotals)
    .filter(function (ym) {
      return ym < currentMonth;
    })
    .sort()
    .slice(-CONFIG.forecast.paceMonths);

  if (completed.length === 0) return { available: false };

  var sum = 0;
  completed.forEach(function (ym) {
    sum += monthlyTotals[ym];
  });
  var average = Math.round(sum / completed.length);
  var remainingMonths = 12 - Number(currentMonth.slice(5, 7));
  var yearEnd = annual.totalRevenue + average * remainingMonths;

  // どの壁に、いつごろ届くか
  var reach = null;
  walls.forEach(function (w) {
    if (reach || average <= 0) return;
    if (annual.totalRevenue >= w.amount) return;
    var running = annual.totalRevenue;
    for (var i = 1; i <= remainingMonths; i++) {
      running += average;
      if (running >= w.amount) {
        reach = { wallName: w.name, yearMonth: addMonths_(currentMonth, i) };
        return;
      }
    }
  });

  return {
    available: true,
    months: completed.length,
    monthlyAverage: average,
    remainingMonths: remainingMonths,
    yearEndEstimate: yearEnd,
    reach: reach
  };
}

/** 調整アドバイスを組み立てる */
function buildAdvice_(forecast, planned) {
  var advice = [];

  forecast.months.forEach(function (m) {
    var label = '【' + m.yearMonth + '】' + m.companyName;
    if (m.status === '警告') {
      var cut = chooseShiftsToCut_(m.plannedShifts, m.overHours);
      if (cut.shifts.length > 0) {
        advice.push({
          level: '警告',
          text:
            label + ' は見込み ' + m.projectedHours + '時間で、上限 ' + m.limit + '時間を ' + m.overHours + '時間超えます。' +
            describeShifts_(cut.shifts) + ' を外すと ' + round2_(m.projectedHours - cut.hours) + '時間になり収まります。'
        });
      } else {
        advice.push({
          level: '警告',
          text:
            label + ' は既に実績 ' + m.actualHours + '時間で上限 ' + m.limit + '時間を超えています。' +
            'この先の予定を外しても戻せないため、勤務先の労務担当に相談してください。'
        });
      }
    } else if (m.status === '注意') {
      advice.push({
        level: '注意',
        text:
          label + ' は見込み ' + m.projectedHours + '時間（上限の' + Math.round(m.ratio * 100) + '%）。' +
          'あと ' + m.remainingHours + '時間で上限です。'
      });
    }
  });

  (forecast.consecutive || []).forEach(function (c) {
    if (c.status === '正常' || !c.message) return;
    advice.push({ level: c.status, text: '（予定を含めた見込み）' + c.message });
  });

  var wage = forecast.averageWage;
  forecast.walls.forEach(function (w) {
    if (w.status === '警告') {
      var over = Math.abs(w.remaining);
      advice.push({
        level: '警告',
        text:
          '予定を全部こなすと ' + w.name + 'の壁を ' + yen_(over) + ' 超えます。' +
          (wage > 0 ? '平均時給' + yen_(wage) + 'なら ' + Math.ceil(over / wage) + '時間分（8時間勤務で約' + Math.ceil(over / wage / 8) + '日分）減らす必要があります。' : '')
      });
    } else if (w.status === '注意') {
      advice.push({
        level: '注意',
        text: '予定を全部こなすと ' + w.name + 'の壁まで残り ' + yen_(w.remaining) + '（' + Math.round(w.ratio * 100) + '%）です。'
      });
    } else {
      advice.push({
        level: '情報',
        text:
          '予定を全部こなしても ' + w.name + 'まで ' + yen_(w.remaining) + ' 余裕があります。' +
          (wage > 0 ? '平均時給' + yen_(wage) + 'なら あと' + Math.floor(w.remaining / wage) + '時間（8時間勤務で約' + Math.floor(w.remaining / wage / 8) + '日）働けます。' : '')
      });
    }
  });

  if (forecast.pace.available && forecast.pace.reach) {
    advice.push({
      level: '注意',
      text:
        '直近' + forecast.pace.months + 'ヶ月の平均（月 ' + yen_(forecast.pace.monthlyAverage) + '・カレンダー分のみ）で年末まで続けると、' +
        forecast.pace.reach.wallName + 'の壁に ' + forecast.pace.reach.yearMonth + ' ごろ到達する見込みです（目安）。'
    });
  } else if (forecast.pace.available) {
    advice.push({
      level: '情報',
      text:
        '直近' + forecast.pace.months + 'ヶ月の平均（月 ' + yen_(forecast.pace.monthlyAverage) + '・カレンダー分のみ）で続けた場合の年末見込みは ' +
        yen_(forecast.pace.yearEndEstimate) + ' です（目安）。'
    });
  }

  if (forecast.plannedCount === 0) {
    advice.push({
      level: '情報',
      text: 'この先' + forecast.days + '日のカレンダーに勤務予定は入っていません。予定を入れると、ここに見込みと調整案が出ます。'
    });
  }
  return advice;
}

/** 超過分を解消するのに外すシフトを選ぶ（件数が少なくて済むよう長い順に） */
function chooseShiftsToCut_(plannedShifts, overHours) {
  var sorted = plannedShifts.slice().sort(function (a, b) {
    return toNumber_(b.worked_hours) - toNumber_(a.worked_hours);
  });
  var picked = [];
  var hours = 0;
  for (var i = 0; i < sorted.length && hours < overHours; i++) {
    picked.push(sorted[i]);
    hours += toNumber_(sorted[i].worked_hours);
  }
  if (hours < overHours) return { shifts: [], hours: 0 };
  picked.sort(function (a, b) {
    return a.date < b.date ? -1 : 1;
  });
  return { shifts: picked, hours: round2_(hours) };
}

function describeShifts_(shifts) {
  return shifts
    .map(function (s) {
      return formatShortDate_(s.date) + ' ' + s.worked_hours + '時間';
    })
    .join(' と ');
}

/* ======================= Summary.js ======================= */

/** サマリーシートの作成と、通知本文の組み立て */

var SUMMARY_COLS = 6;

/** 各シートを読み込み、その時点の集計結果（スナップショット）を作る */
function buildSnapshot_(today, runInfo, options) {
  var targetYear = resolveTargetYear_(today);
  var yearMonth = formatYearMonth_(today);
  var calendarRows = readTable_(SHEETS.CALENDAR).rows;
  var manualRows = readTable_(SHEETS.MANUAL).rows;
  var limitRows = readTable_(SHEETS.LIMITS).rows;
  var wallRows = readTable_(SHEETS.WALLS).rows;
  var reconcileRows = readTable_(SHEETS.RECONCILE).rows;

  var annual = aggregateAnnual_(calendarRows, manualRows, targetYear);
  var walls = evaluateWalls_(wallRows, annual.totalRevenue, targetYear);
  var hours = aggregateMonthlyHours_(calendarRows, limitRows, yearMonth);
  var weekly = aggregateWeeklyHours_(calendarRows, limitRows, today);
  var consecutive = evaluateConsecutiveMonths_(calendarRows, limitRows, today);
  // 見込みはカレンダーを読むため時間がかかる。アプリの初回表示では飛ばして
  // 画面を先に出し、表示後の同期で埋める（options.skipForecast）。
  var forecast = options && options.skipForecast
    ? { available: false, pending: true, reason: '読み込み中です', advice: [] }
    : buildForecast_(calendarRows, limitRows, walls, annual, today);

  var messages = [];
  var tzWarning = timeZoneWarning_();
  if (tzWarning) messages.push(tzWarning);
  messages = messages.concat(annual.warnings);
  if (runInfo) {
    messages = messages.concat(runInfo.errors || []).concat(runInfo.warnings || []);
  }

  var level = '正常';
  walls.concat(hours).concat(weekly).concat(consecutive).forEach(function (x) {
    if (x.status === '警告') level = '警告';
    else if (x.status === '注意' && level === '正常') level = '注意';
  });
  var openReconcile = reconcileRows.filter(function (r) {
    return String(r.status || '') === '要確認';
  });
  if (openReconcile.length > 0 && level === '正常') level = '注意';

  // 見込みの段階で超える場合も、調整できるうちに知らせたいので反映する
  (forecast.advice || []).forEach(function (a) {
    if (a.level === '警告') level = '警告';
    else if (a.level === '注意' && level === '正常') level = '注意';
  });
  if (forecast.errors) messages = messages.concat(forecast.errors);

  return {
    generatedAt: formatDateTime_(today),
    targetYear: targetYear,
    yearMonth: yearMonth,
    annual: annual,
    walls: walls,
    hours: hours,
    weekly: weekly,
    consecutive: consecutive,
    reconcileRows: reconcileRows,
    forecast: forecast,
    messages: messages,
    level: level,
    runInfo: runInfo || null
  };
}

/** サマリーシートを書き換える */
function writeSummarySheet_(snapshot) {
  var sheet = getSheet_(SHEETS.SUMMARY);
  sheet.clear();
  // 前回の結合を解除してから書き込む（結合セルがあると setValues が失敗するため）
  sheet.getRange(1, 1, 1, SUMMARY_COLS).breakApart();

  var rows = [];
  var headerRowIndexes = [];
  var statusCells = [];

  function push(values) {
    var line = values.slice();
    while (line.length < SUMMARY_COLS) line.push('');
    rows.push(line);
    return rows.length;
  }
  function section(titleText) {
    push(['']);
    headerRowIndexes.push(push(['■ ' + titleText]));
  }
  function tableHeader(values) {
    headerRowIndexes.push(push(values));
  }
  function statusRow(values, statusColIndex) {
    var rowIndex = push(values);
    statusCells.push({ row: rowIndex, col: statusColIndex, value: values[statusColIndex - 1] });
  }

  push([CONFIG.disclaimer]);
  push(['']);
  push(['最終更新', snapshot.generatedAt, '', '全体ステータス', snapshot.level]);
  push(['集計対象年', snapshot.targetYear + '年', '', '当月', snapshot.yearMonth]);

  var a = snapshot.annual;

  section('年間の壁までの残り（額面ベース）');
  tableHeader(['壁', '金額', '現在の年間収入(額面)', '残り', '進捗', '状態']);
  if (snapshot.walls.length === 0) {
    push(['(wall_thresholds シートに壁が登録されていません)']);
  }
  snapshot.walls.forEach(function (w) {
    statusRow(
      [
        w.name,
        yen_(w.amount),
        yen_(a.totalRevenue),
        yen_(w.remaining),
        Math.round(w.ratio * 100) + '%',
        w.status
      ],
      6
    );
  });

  section('年間収入（額面）の内訳 ※ 源泉徴収前の総支給額で計算');
  tableHeader(['項目', '金額', '備考']);
  push(['給与収入（カレンダー推定）', yen_(a.calendarRevenue), 'calendar_income_entries の合計']);
  push(['給与収入（手入力）', yen_(a.manualSalaryRevenue), 'manual_income_entries の給与所得']);
  push(['給与収入 合計', yen_(a.salaryRevenue), '']);
  push(['事業収入', yen_(a.businessRevenue), '必要経費 ' + yen_(a.businessExpenses)]);
  push(['雑収入', yen_(a.miscRevenue), '必要経費 ' + yen_(a.miscExpenses)]);
  push(['年間収入 合計（壁の判定に使用）', yen_(a.totalRevenue), '']);

  section('合計所得金額 ※ 収入額そのものとは別の数値。税金の壁の判定に使う');
  tableHeader(['項目', '金額', '計算式']);
  push([
    '給与所得',
    yen_(a.salaryIncome),
    '給与収入 ' + yen_(a.salaryRevenue) + ' − 給与所得控除 ' + yen_(a.salaryDeduction)
  ]);
  push([
    '事業所得',
    yen_(a.businessIncome),
    '事業収入 ' + yen_(a.businessRevenue) + ' − 必要経費 ' + yen_(a.businessExpenses)
  ]);
  push([
    '雑所得',
    yen_(a.miscIncome),
    '雑収入 ' + yen_(a.miscRevenue) + ' − 必要経費 ' + yen_(a.miscExpenses)
  ]);
  push(['合計所得金額', yen_(a.totalIncome), '']);

  section(
    '当月（' +
      snapshot.yearMonth +
      '）の勤務先ごとの労働時間 ※4分の3基準の暫定運用：上限の' +
      Math.round(CONFIG.hours.warnRatio * 100) +
      '%で注意、' +
      Math.round(CONFIG.hours.alertRatio * 100) +
      '%で警告'
  );
  tableHeader(['勤務先', '当月実働(h)', '月間上限(h)', '進捗', '勤務日数', '状態']);
  if (snapshot.hours.length === 0) {
    push(['(当月の勤務データはまだありません)']);
  }
  snapshot.hours.forEach(function (h) {
    statusRow(
      [
        h.companyName + (h.confirmed ? '' : '（上限は暫定値）'),
        h.hours,
        h.limit,
        Math.round(h.ratio * 100) + '%',
        h.days,
        h.status
      ],
      6
    );
  });

  var forecast = snapshot.forecast || { available: false, advice: [] };
  if (forecast.available) {
    section(
      'この先の見込み（' + forecast.from + '〜' + forecast.to + ' のカレンダー予定 ' + forecast.plannedCount + '件 / ' +
        forecast.plannedHours + '時間 / ' + yen_(forecast.plannedRevenue) + '）'
    );
    tableHeader(['勤務先', '対象月', '実績(h)', '予定(h)', '見込み(h)', '状態']);
    if (forecast.months.length === 0) {
      push(['(この先の勤務予定はありません)']);
    }
    forecast.months.forEach(function (m) {
      statusRow(
        [m.companyName, m.yearMonth, m.actualHours, m.plannedHours, m.projectedHours + ' / ' + m.limit, m.status],
        6
      );
    });

    tableHeader(['壁', '金額', '予定を全部こなした場合', '残り', '進捗', '状態']);
    forecast.walls.forEach(function (w) {
      statusRow(
        [w.name, yen_(w.amount), yen_(w.projectedRevenue), yen_(w.remaining), Math.round(w.ratio * 100) + '%', w.status],
        6
      );
    });

    section('勤務調整のアドバイス');
    if (forecast.advice.length === 0) {
      push(['特にありません']);
    }
    forecast.advice.forEach(function (a) {
      statusRow([a.text, '', '', '', '', a.level], 6);
    });
  }

  var weeklyRows = (snapshot.weekly || []).filter(function (w) {
    return w.isCurrentWeek || w.hours > 0;
  });
  if (weeklyRows.length > 0) {
    section('週ごとの労働時間（正社員の週所定労働時間の4分の3が基準の勤務先）');
    tableHeader(['勤務先', '週（月曜〜日曜）', '実働(h)', '週の上限(h)', '残り(h)', '状態']);
    weeklyRows.forEach(function (w) {
      statusRow(
        [
          w.companyName + (w.isCurrentWeek ? '（今週）' : ''),
          w.weekStart + ' 〜 ' + w.weekEnd,
          w.hours,
          w.limit,
          w.remainingHours,
          w.status
        ],
        6
      );
    });
  }

  var consecutiveRows = (snapshot.consecutive || []).filter(function (c) {
    return c.requiredMonths >= 2;
  });
  if (consecutiveRows.length > 0) {
    section('連続月の判定（「月◯時間以上が◯ヶ月連続」が基準の勤務先）');
    tableHeader(['勤務先', '条件', '実績', '状態']);
    consecutiveRows.forEach(function (c) {
      statusRow(
        [
          c.companyName,
          '月' + c.limit + '時間以上が' + c.requiredMonths + 'ヶ月連続',
          c.months
            .map(function (m) {
              return m.yearMonth + ' ' + m.hours + 'h';
            })
            .join(' / '),
          c.status,
          '',
          c.status
        ],
        6
      );
      if (c.message) push(['　→ ' + c.message]);
    });
  }

  section('月次の答え合わせ（給与明細との差分）');
  tableHeader(['年月', '勤務先', 'カレンダー推定額', '実際の支給額', '差分', '状態']);
  var recent = snapshot.reconcileRows.slice(-12);
  if (recent.length === 0) {
    push(['(まだ入力がありません。メニュー「月次の答え合わせを入力」から登録してください)']);
  }
  recent.forEach(function (r) {
    statusRow(
      [
        String(r.year_month),
        String(r.company_name),
        yen_(toNumber_(r.estimated_amount)),
        yen_(toNumber_(r.actual_amount)),
        yen_(toNumber_(r.diff)),
        String(r.status || '')
      ],
      6
    );
  });

  section('注意メッセージ');
  if (snapshot.messages.length === 0) {
    push(['なし']);
  }
  snapshot.messages.slice(0, 30).forEach(function (m) {
    push([m]);
  });

  push(['']);
  push([CONFIG.disclaimer]);

  sheet.getRange(1, 1, rows.length, SUMMARY_COLS).setValues(rows);

  // 体裁
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SUMMARY_COLS).merge().setBackground('#fff3cd').setFontWeight('bold').setWrap(true);
  headerRowIndexes.forEach(function (r) {
    sheet.getRange(r, 1, 1, SUMMARY_COLS).setFontWeight('bold').setBackground('#eceff1');
  });
  statusCells.forEach(function (c) {
    var color = c.value === '警告' || c.value === '要確認' ? '#c62828' : c.value === '注意' ? '#ef6c00' : '#2e7d32';
    sheet.getRange(c.row, c.col).setFontColor(color).setFontWeight('bold');
  });
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 180);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 110);
}

/** 通知（メール／Webhook）用のテキストを組み立てる */
function buildNotificationText_(snapshot) {
  var a = snapshot.annual;
  var lines = [];
  lines.push('■ ' + snapshot.generatedAt + ' 時点（' + snapshot.targetYear + '年）');
  if (snapshot.runInfo) {
    lines.push(
      '今日の取り込み: ' +
        snapshot.runInfo.entries.length +
        '件（対象外の予定 ' +
        snapshot.runInfo.skipped +
        '件 / 解析エラー ' +
        (snapshot.runInfo.errors || []).length +
        '件）'
    );
    snapshot.runInfo.entries.forEach(function (e) {
      lines.push(
        '  ・' + e.company_name + ' ' + e.start_time + '-' + e.end_time + ' ' + e.worked_hours + 'h ' + yen_(e.estimated_amount)
      );
    });
  }
  lines.push('');
  lines.push('【年間の壁までの残り】年間収入(額面) ' + yen_(a.totalRevenue));
  snapshot.walls.forEach(function (w) {
    lines.push(
      '  ・' + w.name + ' : 残り ' + yen_(w.remaining) + '（' + Math.round(w.ratio * 100) + '%）' + w.status
    );
  });
  lines.push('  ・参考：合計所得金額 ' + yen_(a.totalIncome));
  lines.push('');
  lines.push('【当月（' + snapshot.yearMonth + '）の労働時間】');
  if (snapshot.hours.length === 0) {
    lines.push('  ・当月の勤務データはまだありません');
  }
  snapshot.hours.forEach(function (h) {
    lines.push(
      '  ・' +
        h.companyName +
        ' : ' +
        h.hours +
        'h / ' +
        h.limit +
        'h（' +
        Math.round(h.ratio * 100) +
        '%）' +
        h.status +
        (h.confirmed ? '' : ' ※上限は暫定値')
    );
  });
  var currentWeek = (snapshot.weekly || []).filter(function (w) {
    return w.isCurrentWeek;
  });
  if (currentWeek.length > 0) {
    lines.push('');
    lines.push('【今週の労働時間（週の上限がある勤務先）】');
    currentWeek.forEach(function (w) {
      lines.push('  ・' + w.companyName + ' : ' + w.hours + 'h / ' + w.limit + 'h ' + w.status);
    });
  }
  (snapshot.consecutive || []).forEach(function (c) {
    if (c.status === '正常' || !c.message) return;
    lines.push('');
    lines.push('【連続月の注意】' + c.message);
  });

  var forecast = snapshot.forecast;
  if (forecast && forecast.available) {
    lines.push('');
    lines.push('【この先' + forecast.days + '日の見込み】予定 ' + forecast.plannedCount + '件 / ' + forecast.plannedHours + '時間 / ' + yen_(forecast.plannedRevenue));
    forecast.months.forEach(function (m) {
      lines.push(
        '  ・' + m.yearMonth + ' ' + m.companyName + ' : 実績' + m.actualHours + 'h + 予定' + m.plannedHours + 'h = ' +
          m.projectedHours + 'h / ' + m.limit + 'h ' + m.status
      );
    });
    if (forecast.advice.length > 0) {
      lines.push('');
      lines.push('【勤務調整のアドバイス】');
      forecast.advice.forEach(function (a) {
        lines.push('  ・[' + a.level + '] ' + a.text);
      });
    }
  }

  if (snapshot.messages.length > 0) {
    lines.push('');
    lines.push('【注意メッセージ】');
    snapshot.messages.slice(0, 20).forEach(function (m) {
      lines.push('  ・' + m);
    });
  }
  lines.push('');
  lines.push(CONFIG.disclaimer);
  return lines.join('\n');
}

/* ======================= Notify.js ======================= */

/**
 * 通知
 *
 * 既定は 'sheet'（サマリーシートと実行ログの更新のみ、外部送信なし）。
 * CONFIG.notify.channel を 'email' / 'webhook' に変えると毎日の実行結果を送る。
 */

function notify_(snapshot) {
  var body = buildNotificationText_(snapshot);
  var subject = '[年収の壁] ' + snapshot.generatedAt.slice(0, 10) + ' ' + snapshot.level;

  writeLog_('daily', snapshot.level, body.split('\n').slice(0, 3).join(' / '));

  var channel = CONFIG.notify.channel;
  var isAlert = snapshot.level !== '正常';
  if (channel === 'sheet' && !(CONFIG.notify.alwaysNotifyOnAlert && isAlert)) {
    return { channel: 'sheet', sent: false };
  }

  try {
    if (channel === 'webhook' && CONFIG.notify.webhookUrl) {
      postWebhook_(subject + '\n' + body);
      return { channel: 'webhook', sent: true };
    }
    var to = CONFIG.notify.emailTo || Session.getEffectiveUser().getEmail();
    if (!to) return { channel: channel, sent: false };
    MailApp.sendEmail(to, subject, body);
    return { channel: 'email', sent: true };
  } catch (e) {
    writeLog_('notify', '警告', '通知の送信に失敗しました: ' + e.message);
    return { channel: channel, sent: false, error: e.message };
  }
}

function postWebhook_(text) {
  var payload;
  if (CONFIG.notify.webhookFormat === 'discord') payload = { content: text };
  else if (CONFIG.notify.webhookFormat === 'json') payload = { message: text };
  else payload = { text: text };

  UrlFetchApp.fetch(CONFIG.notify.webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/* ======================= Html.js ======================= */

/**
 * HTML ファイルの読み込み
 *
 * 通常はプロジェクト内の .html ファイルを使うが、
 * 全部入りの1ファイル版（dist/all-in-one.gs）では HTML も同じファイルに
 * 埋め込まれるため、その場合は INLINE_HTML から読む。
 */
var INLINE_HTML = {};

function htmlTemplate_(name) {
  if (INLINE_HTML[name]) return HtmlService.createTemplate(INLINE_HTML[name]);
  return HtmlService.createTemplateFromFile(name);
}

function htmlOutput_(name) {
  if (INLINE_HTML[name]) return HtmlService.createHtmlOutput(INLINE_HTML[name]);
  return HtmlService.createHtmlOutputFromFile(name);
}

/* ======================= Reconcile.js ======================= */

/**
 * 月次の答え合わせ
 *
 * 実際の給与明細・支給照会の合計額を月1回入力し、カレンダー推定額との差分を見る。
 * 入力方法は2通り:
 *   ・メニュー「月次の答え合わせを入力」→ 入力フォーム（PC向け）
 *   ・monthly_reconciliation シートに直接 actual_amount を入力 →
 *     メニュー「月次の答え合わせを再計算」で差分を計算（スマホからでも可）
 */

var RECONCILE_ALL = '合計（全勤務先）';

function openReconcileDialog() {
  ensureSheets_();
  var html = htmlOutput_('Reconcile').setWidth(460).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, '月次の答え合わせ');
}

/** ダイアログ初期表示用のデータ */
function getReconcileFormData() {
  ensureSheets_();
  var rows = readTable_(SHEETS.CALENDAR).rows;
  var monthsSet = {};
  var companiesSet = {};
  rows.forEach(function (r) {
    var ym = yearMonthOfDateString_(toDateString_(r.date));
    if (ym) monthsSet[ym] = true;
    var name = String(r.company_name || '').trim();
    if (name) companiesSet[name] = true;
  });
  readTable_(SHEETS.LIMITS).rows.forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (name) companiesSet[name] = true;
  });
  monthsSet[formatYearMonth_(new Date())] = true;

  var months = Object.keys(monthsSet).sort().reverse();
  var companies = Object.keys(companiesSet).sort();
  companies.unshift(RECONCILE_ALL);

  var estimates = {};
  months.forEach(function (ym) {
    companies.forEach(function (c) {
      estimates[ym + '\t' + c] = estimatedForMonth_(rows, ym, c);
    });
  });

  return {
    months: months,
    companies: companies,
    estimates: estimates,
    disclaimer: CONFIG.disclaimer,
    tolerance: CONFIG.reconcile
  };
}

/** 指定月・指定勤務先のカレンダー推定額 */
function estimatedForMonth_(calendarRows, yearMonth, companyName) {
  var total = 0;
  calendarRows.forEach(function (r) {
    if (yearMonthOfDateString_(toDateString_(r.date)) !== yearMonth) return;
    if (companyName && companyName !== RECONCILE_ALL && String(r.company_name).trim() !== companyName) return;
    total += toNumber_(r.estimated_amount);
  });
  return total;
}

/** ダイアログから呼ばれる保存処理 */
function saveReconciliation(payload) {
  ensureSheets_();
  var yearMonth = String(payload.yearMonth || '').trim();
  var companyName = String(payload.companyName || '').trim() || RECONCILE_ALL;
  var actual = toNumber_(payload.actualAmount);
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error('年月は yyyy-MM の形式で入力してください');

  var calendarRows = readTable_(SHEETS.CALENDAR).rows;
  var estimated = estimatedForMonth_(calendarRows, yearMonth, companyName);
  var evaluated = evaluateReconciliation_(estimated, actual);

  upsertRows_(
    SHEETS.RECONCILE,
    [
      {
        id: yearMonth + '|' + companyName,
        year_month: yearMonth,
        company_name: companyName,
        actual_amount: actual,
        estimated_amount: estimated,
        diff: evaluated.diff,
        diff_rate: Math.round(evaluated.rate * 1000) / 10 + '%',
        status: evaluated.status,
        note: String(payload.note || ''),
        entered_at: formatDateTime_(new Date())
      }
    ],
    'id'
  );

  markReconciled_(yearMonth, companyName);
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  writeLog_(
    'reconcile',
    evaluated.status === 'OK' ? '正常' : '注意',
    yearMonth + ' ' + companyName + ' 推定 ' + yen_(estimated) + ' / 実額 ' + yen_(actual) + ' / 差分 ' + yen_(evaluated.diff)
  );

  return {
    estimated: estimated,
    actual: actual,
    diff: evaluated.diff,
    rate: evaluated.rate,
    status: evaluated.status,
    message:
      evaluated.status === 'OK'
        ? '推定額とほぼ一致しました（差分 ' + yen_(evaluated.diff) + '）。'
        : '差分が大きいです（' +
          yen_(evaluated.diff) +
          ' / ' +
          Math.round(evaluated.rate * 1000) / 10 +
          '%）。カレンダーの入力漏れ・時給の変更・手当や交通費の有無を確認してください。'
  };
}

/** 対象月・対象勤務先のカレンダー明細に「照合済み」を立てる */
function markReconciled_(yearMonth, companyName) {
  var sheet = getSheet_(SHEETS.CALENDAR);
  var col = SCHEMA[SHEETS.CALENDAR].indexOf('reconciled') + 1;
  var changed = false;
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    if (yearMonthOfDateString_(toDateString_(r.date)) !== yearMonth) return;
    if (companyName !== RECONCILE_ALL && String(r.company_name).trim() !== companyName) return;
    sheet.getRange(r._rowIndex, col).setValue(true);
    changed = true;
  });
  if (changed) invalidateTable_(SHEETS.CALENDAR);
}

/** シートに直接入力された actual_amount から差分を計算し直す */
function recalcReconciliations_() {
  var table = readTable_(SHEETS.RECONCILE);
  if (table.rows.length === 0) return 0;
  var calendarRows = readTable_(SHEETS.CALENDAR).rows;
  var updates = [];

  // 手入力された行は id が空のこともあるので、id ではなく行番号を指定して書き戻す
  table.rows.forEach(function (r) {
    var yearMonth = String(r.year_month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return;
    var companyName = String(r.company_name || '').trim() || RECONCILE_ALL;
    var actual = toNumber_(r.actual_amount);
    if (!actual) return;
    var estimated = estimatedForMonth_(calendarRows, yearMonth, companyName);
    var evaluated = evaluateReconciliation_(estimated, actual);
    var updated = {
      id: r.id || yearMonth + '|' + companyName,
      year_month: yearMonth,
      company_name: companyName,
      actual_amount: actual,
      estimated_amount: estimated,
      diff: evaluated.diff,
      diff_rate: Math.round(evaluated.rate * 1000) / 10 + '%',
      status: evaluated.status,
      note: r.note || '',
      entered_at: r.entered_at || formatDateTime_(new Date())
    };
    writeRowAt_(SHEETS.RECONCILE, r._rowIndex, updated);
    updates.push(updated);
  });

  updates.forEach(function (u) {
    markReconciled_(u.year_month, u.company_name);
  });
  return updates.length;
}

function recalcReconciliationsFromMenu() {
  ensureSheets_();
  var count = recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  toast_(count + '件の答え合わせを再計算しました。');
}

/* ======================= SeedData.js ======================= */

/**
 * 実データの初期投入
 *
 * カレンダーに入っていない過去の確定収入と、既に働いた分のシフトを一括で登録する。
 * メニュー「実データを取り込む（初回のみ）」から実行する。
 *
 * 何度実行しても重複しない（同じキーの行を上書きする）。
 * カレンダーから同じ日を取り込んだ場合は、カレンダー側の行が優先される。
 */

/**
 * カレンダー化されていない収入（確定額）
 *
 * ここは空のまま公開リポジトリに置いています。実際の金額は個人情報なので、
 * 自分の Apps Script プロジェクト側でだけ中身を書いてください。
 *
 * 書き方:
 *   {
 *     source_name: '〇〇株式会社',
 *     income_category: '給与所得',        // 給与所得 / 事業所得 / 雑所得
 *     period: '2026-03〜2026-05',        // 年が分かる形で
 *     amount: 100000,                    // 額面（円）
 *     expenses: 0,                       // 必要経費（円）。給与所得なら0
 *     note: '3月分〜5月分'
 *   }
 */
var SEED_MANUAL_INCOME = [];

/**
 * カレンダーに入っていない、既に働いた分のシフト
 * [日付, 勤務先, 開始, 終了, 休憩(h), 時給(円), 手当(円)]
 * 手当は省略可（単発バイトで出る交通費・食事補助などの固定額）。
 *
 * 書き方:
 *   ['2026-06-10', '〇〇', '09:00', '18:00', 1, 1200]
 *   ['2026-06-11', '〇〇', '09:00', '17:00', 0, 1500, 1000]
 */
var SEED_SHIFTS = [];

/**
 * 勤務先ごとの上限（会社から回答をもらったもの）
 *
 * ここも空のまま公開リポジトリに置いています。会社名は個人情報なので、
 * 自分の Apps Script プロジェクト側でだけ書いてください。
 *
 * 書き方:
 *   {
 *     company_name: '〇〇',
 *     monthly_hour_limit: 130,   // 月の上限（時間）
 *     weekly_hour_limit: 30,     // 週の上限（時間）。無ければ 0
 *     consecutive_months: 1,     // 「◯ヶ月連続で対象」と言われた場合その月数。通常は1
 *     confirmed: true,           // 会社から正式な回答をもらったか
 *     basis: '正社員の週所定労働時間40時間の3/4（2026-08-23 メール回答）'
 *   }
 */
var SEED_COMPANY_LIMITS = [];

/** 同じ勤務を指すかどうかの判定キー */
function shiftKey_(date, companyName, startTime) {
  return toDateString_(date) + '\t' + String(companyName).trim() + '\t' + toTimeString_(startTime);
}

/** メニューから呼ぶ本体 */
function importSeedData() {
  ensureSheets_();
  if (SEED_MANUAL_INCOME.length === 0 && SEED_SHIFTS.length === 0 && SEED_COMPANY_LIMITS.length === 0) {
    showAlert_(
      '登録するデータがありません',
      'SeedData の SEED_MANUAL_INCOME と SEED_SHIFTS に、収入とシフトを書いてから実行してください。'
    );
    return null;
  }
  var manual = seedManualIncome_();
  var shifts = seedShifts_();
  var limits = seedCompanyLimits_();

  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);

  var message =
    '手入力の収入: ' + manual.inserted + '件追加 / ' + manual.updated + '件更新\n' +
    'シフト: ' + shifts.inserted + '件追加 / ' + shifts.updated + '件更新' +
    (shifts.skipped ? ' / ' + shifts.skipped + '件はカレンダー取り込み済みのため見送り' : '') +
    (limits.inserted + limits.updated > 0
      ? '\n勤務先の上限: ' + limits.inserted + '件追加 / ' + limits.updated + '件更新'
      : '');
  writeLog_('seed', '正常', message.replace(/\n/g, ' '));
  showSummaryAlert_('実データを取り込みました\n\n' + message, snapshot);
  return snapshot;
}

/** 確定収入を登録（収入元＋対象期間をキーに上書き） */
function seedManualIncome_() {
  var now = formatDateTime_(new Date());
  var rows = SEED_MANUAL_INCOME.map(function (item) {
    return {
      id: 'seed-manual\t' + item.source_name + '\t' + item.period,
      source_name: item.source_name,
      income_category: item.income_category,
      period: item.period,
      amount: item.amount,
      expenses: item.expenses,
      note: item.note,
      updated_at: now
    };
  });
  return upsertRows_(SHEETS.MANUAL, rows, 'id');
}

/** 会社から回答をもらった上限を登録（勤務先名をキーに上書き） */
function seedCompanyLimits_() {
  if (SEED_COMPANY_LIMITS.length === 0) return { inserted: 0, updated: 0 };
  var now = formatDateTime_(new Date());
  var rows = SEED_COMPANY_LIMITS.map(function (item) {
    return {
      company_name: item.company_name,
      monthly_hour_limit: item.monthly_hour_limit,
      confirmed: !!item.confirmed,
      note: item.confirmed ? '会社から回答済みの実数' : '暫定値',
      updated_at: now,
      weekly_hour_limit: item.weekly_hour_limit || 0,
      consecutive_months: item.consecutive_months || 1,
      basis: item.basis || ''
    };
  });
  return upsertRows_(SHEETS.LIMITS, rows, 'company_name');
}

/** シフトを勤務明細に登録（カレンダーから取り込み済みの勤務は触らない） */
function seedShifts_() {
  var now = formatDateTime_(new Date());
  var existing = {};
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    existing[shiftKey_(r.date, r.company_name, r.start_time)] = String(r.id);
  });

  var rows = [];
  var skipped = 0;
  SEED_SHIFTS.forEach(function (shift) {
    var date = shift[0];
    var companyName = shift[1];
    var startTime = shift[2];
    var endTime = shift[3];
    var breakHours = shift[4];
    var hourlyWage = shift[5];
    var allowance = toNumber_(shift[6]);
    var id = 'seed-shift\t' + date + '\t' + companyName + '\t' + startTime;
    var already = existing[shiftKey_(date, companyName, startTime)];
    if (already && already !== id) {
      // 同じ勤務がカレンダーから取り込まれている。二重計上を避けるため登録しない
      skipped++;
      return;
    }
    var workedHours = computeWorkedHours_(startTime, endTime, breakHours);
    rows.push({
      id: id,
      date: date,
      company_name: companyName,
      start_time: startTime,
      end_time: endTime,
      break_hours: breakHours,
      worked_hours: round2_(workedHours),
      hourly_wage: hourlyWage,
      estimated_amount: computeEstimatedAmount_(workedHours, hourlyWage, allowance),
      reconciled: false,
      source_title: '手入力（会話で確定した実績）',
      updated_at: now,
      allowance: allowance
    });
  });

  var result = upsertRows_(SHEETS.CALENDAR, rows, 'id', function (before, after) {
    var merged = {};
    Object.keys(after).forEach(function (k) {
      merged[k] = after[k];
    });
    merged.reconciled = toBool_(before.reconciled);
    return merged;
  });
  ensureCompanyLimits_(
    rows.map(function (r) {
      return r.company_name;
    })
  );
  result.skipped = skipped;
  return result;
}

/**
 * カレンダーから取り込む勤務と同じ勤務を指す手入力行を削除する。
 * 同じ日・同じ勤務先・同じ開始時刻ならカレンダー側を正とし、二重計上を防ぐ。
 */
function removeSeededDuplicates_(entries) {
  if (!entries || entries.length === 0) return 0;
  var wanted = {};
  entries.forEach(function (e) {
    wanted[shiftKey_(e.date, e.company_name, e.start_time)] = String(e.id);
  });

  var sheet = getSheet_(SHEETS.CALENDAR);
  var remove = [];
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    var key = shiftKey_(r.date, r.company_name, r.start_time);
    if (wanted[key] && String(r.id) !== wanted[key]) remove.push(r._rowIndex);
  });
  remove
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (rowIndex) {
      sheet.deleteRow(rowIndex);
    });
  if (remove.length > 0) invalidateTable_(SHEETS.CALENDAR);
  return remove.length;
}

/* ======================= WebApp.js ======================= */

/**
 * ウェブアプリ（スマホから開く画面）
 *
 * 「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」で公開すると、
 * https://script.google.com/macros/s/.../exec のURLで開けるようになる。
 * スマホのホーム画面に追加すればアプリのように使える。
 *
 * 公開設定は「次のユーザーとして実行: 自分」「アクセスできるユーザー: 自分のみ」にすること。
 * （収入情報を扱うので、他人がURLを知っても開けないようにする）
 */

function doGet() {
  var template = htmlTemplate_('App');
  var payload;
  try {
    beginExecution_();
    ensureSheets_();
    // ここではカレンダーに触らない。カレンダーの通信は1〜数秒かかるため、
    // 待つと画面が出るまでずっと白いままになる。
    // 先にシートの内容だけで画面を出し、表示後に appSyncCalendar で取り込む。
    payload = buildAppData_({ skipForecast: true });
    payload.needsSync = true;
  } catch (e) {
    payload = { error: e.message, disclaimer: CONFIG.disclaimer };
  }
  // </script> でタグを閉じられないように < をエスケープしてから埋め込む
  template.bootstrapJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  // addMetaTag で指定できるのは viewport / mobile-web-app-capable /
  // apple-mobile-web-app-capable / google-site-verification の4つだけ。
  // それ以外を渡すと「指定したメタタグはこのコンテキストでは使用できません」で落ちる。
  // ホーム画面に追加したときの名前は setTitle の値が使われる。
  return template
    .evaluate()
    .setTitle('年収の壁')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/**
 * 画面が表示されたあとに呼ばれ、カレンダーの取り込みと見込みの計算を行う。
 * 重い処理をここに寄せることで、最初の表示を待たせない。
 */
function appSyncCalendar() {
  beginExecution_();
  ensureSheets_();
  prefetchCalendar_(new Date());
  autoImportRecent_();
  return buildAppData_();
}

/**
 * 直近数日のカレンダーをその場で取り込む。
 * 画面を開いた時点の内容にするためのもので、失敗しても画面表示は止めない。
 */
function autoImportRecent_() {
  var days = CONFIG.app.autoImportDays;
  if (!days) return null;
  try {
    var today = new Date();
    var from = new Date(today.getTime());
    from.setDate(from.getDate() - (days - 1));
    return importDateRange_(from, today);
  } catch (e) {
    writeLog_('app', '注意', 'アプリ表示時の取り込みに失敗しました: ' + e.message);
    return null;
  }
}

/** 画面に表示するデータ一式 */
function buildAppData_(options) {
  var now = new Date();
  var snapshot = buildSnapshot_(now, null, options);
  var a = snapshot.annual;

  var calendarRows = readTable_(SHEETS.CALENDAR).rows;
  var recent = calendarRows
    .map(function (r) {
      return {
        date: toDateString_(r.date),
        companyName: String(r.company_name || ''),
        startTime: toTimeString_(r.start_time),
        endTime: toTimeString_(r.end_time),
        workedHours: toNumber_(r.worked_hours),
        amount: toNumber_(r.estimated_amount),
        allowance: toNumber_(r.allowance),
        fixedAmount: toNumber_(r.fixed_amount),
        reconciled: toBool_(r.reconciled)
      };
    })
    .sort(function (x, y) {
      return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
    })
    .slice(0, 12);

  var limits = readTable_(SHEETS.LIMITS).rows.map(function (r) {
    return {
      companyName: String(r.company_name || ''),
      limit: toNumber_(r.monthly_hour_limit) || CONFIG.hours.defaultMonthlyLimit,
      weeklyLimit: toNumber_(r.weekly_hour_limit),
      consecutiveMonths: toNumber_(r.consecutive_months) || 1,
      confirmed: toBool_(r.confirmed),
      basis: String(r.basis || ''),
      note: String(r.note || '')
    };
  });

  var manual = readTable_(SHEETS.MANUAL).rows.map(function (r) {
    return {
      sourceName: String(r.source_name || ''),
      category: String(r.income_category || ''),
      period: String(r.period || ''),
      amount: toNumber_(r.amount),
      expenses: toNumber_(r.expenses)
    };
  });

  var reconcile = readTable_(SHEETS.RECONCILE)
    .rows.map(function (r) {
      return {
        yearMonth: String(r.year_month || ''),
        companyName: String(r.company_name || ''),
        estimated: toNumber_(r.estimated_amount),
        actual: toNumber_(r.actual_amount),
        diff: toNumber_(r.diff),
        status: String(r.status || '')
      };
    })
    .reverse()
    .slice(0, 8);

  return {
    generatedAt: snapshot.generatedAt,
    targetYear: snapshot.targetYear,
    yearMonth: snapshot.yearMonth,
    level: snapshot.level,
    walls: snapshot.walls.map(function (w) {
      return {
        name: w.name,
        amount: w.amount,
        remaining: w.remaining,
        ratio: w.ratio,
        status: w.status,
        lastUpdated: w.lastUpdated,
        note: w.note
      };
    }),
    hours: snapshot.hours,
    weekly: snapshot.weekly,
    consecutive: snapshot.consecutive,
    forecast: snapshot.forecast,
    annual: {
      calendarRevenue: a.calendarRevenue,
      manualSalaryRevenue: a.manualSalaryRevenue,
      salaryRevenue: a.salaryRevenue,
      businessRevenue: a.businessRevenue,
      businessExpenses: a.businessExpenses,
      miscRevenue: a.miscRevenue,
      miscExpenses: a.miscExpenses,
      totalRevenue: a.totalRevenue,
      allowanceTotal: a.allowanceTotal,
      salaryDeduction: a.salaryDeduction,
      salaryIncome: a.salaryIncome,
      businessIncome: a.businessIncome,
      miscIncome: a.miscIncome,
      totalIncome: a.totalIncome
    },
    recentEntries: recent,
    limits: limits,
    manualEntries: manual,
    reconcileEntries: reconcile,
    reconcileForm: getReconcileFormData(),
    categories: [INCOME_CATEGORY.SALARY, INCOME_CATEGORY.BUSINESS, INCOME_CATEGORY.MISC],
    defaultMonthlyLimit: CONFIG.hours.defaultMonthlyLimit,
    warnPercent: Math.round(CONFIG.hours.warnRatio * 100),
    alertPercent: Math.round(CONFIG.hours.alertRatio * 100),
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    disclaimer: CONFIG.disclaimer
  };
}

/* ------- 画面から呼ばれる処理（いずれも最新データを返す） ------- */

/** 再読み込み（答え合わせの再計算つき） */
function appRefresh() {
  beginExecution_();
  ensureSheets_();
  prefetchCalendar_(new Date());
  autoImportRecent_();
  recalcReconciliations_();
  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return buildAppData_();
}

/** 今日の予定をいますぐ取り込む */
function appRunToday() {
  beginExecution_();
  runAnalysisForDate_(new Date());
  return buildAppData_();
}

/** 指定した日を取り込み直す */
function appImportDate(dateText) {
  beginExecution_();
  var date = parseDateInput_(dateText);
  if (!date) throw new Error('日付は yyyy-MM-dd の形式で入力してください');
  ensureSheets_();
  var run = importDateRange_(date, date);
  writeSummarySheet_(buildSnapshot_(new Date(), run));
  return {
    data: buildAppData_(),
    message:
      run.from + ' を取り込みました（勤務 ' + run.entries.length + '件 / 対象外 ' + run.skipped + '件 / エラー ' + run.errors.length + '件）',
    errors: run.errors
  };
}

/** 月次の答え合わせを保存 */
function appSaveReconciliation(payload) {
  beginExecution_();
  var result = saveReconciliation(payload);
  return { data: buildAppData_(), result: result };
}

/** 手入力の収入を追加 */
function appAddManualIncome(payload) {
  beginExecution_();
  ensureSheets_();
  var sourceName = String(payload.sourceName || '').trim();
  var period = String(payload.period || '').trim();
  if (!sourceName) throw new Error('収入元の名前を入力してください');
  if (yearOfDateString_(period) === null) {
    throw new Error('対象期間から年が読み取れません（例: 2026-03 や 2026-03〜2026-05）');
  }
  var amount = toNumber_(payload.amount);
  if (amount <= 0) throw new Error('金額を入力してください');

  appendRows_(SHEETS.MANUAL, [
    {
      id: Utilities.getUuid(),
      source_name: sourceName,
      income_category: String(payload.category || INCOME_CATEGORY.BUSINESS),
      period: period,
      amount: amount,
      expenses: toNumber_(payload.expenses),
      note: String(payload.note || ''),
      updated_at: formatDateTime_(new Date())
    }
  ]);
  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return { data: buildAppData_(), message: sourceName + ' を登録しました' };
}

/** 勤務先ごとの月間上限を更新（会社から正式な回答が来たとき） */
function appSaveCompanyLimit(payload) {
  beginExecution_();
  ensureSheets_();
  var companyName = String(payload.companyName || '').trim();
  var limit = toNumber_(payload.limit);
  if (!companyName) throw new Error('勤務先を指定してください');
  if (limit <= 0) throw new Error('上限時間は1以上で入力してください');

  var table = readTable_(SHEETS.LIMITS);
  var target = null;
  table.rows.forEach(function (r) {
    if (String(r.company_name).trim() === companyName) target = r;
  });

  var row = {
    company_name: companyName,
    monthly_hour_limit: limit,
    confirmed: !!payload.confirmed,
    note: payload.confirmed ? '会社から回答済みの実数' : '暫定値。正社員の所定労働時間の回答が来たら実数に差し替える',
    updated_at: formatDateTime_(new Date()),
    weekly_hour_limit: toNumber_(payload.weeklyLimit),
    consecutive_months: toNumber_(payload.consecutiveMonths) || 1,
    basis: payload.basis === undefined ? (target ? String(target.basis || '') : '') : String(payload.basis)
  };
  if (target) writeRowAt_(SHEETS.LIMITS, target._rowIndex, row);
  else appendRows_(SHEETS.LIMITS, [row]);

  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return {
    data: buildAppData_(),
    message: companyName + ' の月間上限を ' + limit + '時間' + (payload.confirmed ? '（確定）' : '（暫定）') + ' にしました'
  };
}

/** メニューからアプリのURLを表示する */
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('まだウェブアプリとして公開されていません。\n\nApps Script エディタの右上「デプロイ → 新しいデプロイ」→ 種類「ウェブアプリ」→\n実行するユーザー「自分」／アクセスできるユーザー「自分のみ」で公開してください。');
    return;
  }
  ui.alert('アプリのURL\n\n' + url + '\n\nスマホでこのURLを開き、ブラウザの「ホーム画面に追加」を選ぶとアプリのように使えます。');
}

/* ======================= Main.js ======================= */

/**
 * エントリポイント（メニュー・毎日の実行・トリガー設定）
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('年収の壁ツール')
    .addItem('① 初期セットアップ（シート作成）', 'setupSheets')
    .addItem('② 毎日23:30のトリガーを設定', 'installDailyTrigger')
    .addItem('③ アプリのURLを表示', 'showWebAppUrl')
    .addSeparator()
    .addItem('今日の分析をいま実行', 'runTodayFromMenu')
    .addItem('期間を指定して取り込み直す', 'backfillFromMenu')
    .addItem('サマリーだけ再計算', 'refreshSummaryFromMenu')
    .addSeparator()
    .addItem('実データを取り込む（初回のみ）', 'importSeedData')
    .addSeparator()
    .addItem('月次の答え合わせを入力', 'openReconcileDialog')
    .addItem('月次の答え合わせを再計算', 'recalcReconciliationsFromMenu')
    .addItem('手入力の収入を追加', 'addManualIncomeFromMenu')
    .addSeparator()
    .addItem('トリガーを解除', 'removeDailyTrigger')
    .addItem('セルフテストを実行', 'runTestsFromMenu')
    .addToUi();
}

/** ① 初期セットアップ */
function setupSheets() {
  beginExecution_();
  // 利用者が明示的に実行したときは、記録を無視して移行処理を必ずやり直す
  ensureSheets_({ force: true });
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  writeLog_('setup', '正常', 'シートを初期化しました');
  var tzWarning = timeZoneWarning_();
  if (tzWarning) {
    showAlert_('設定を確認してください', tzWarning);
    return;
  }
  toast_('シートを作成しました。次に「② 毎日23:30のトリガーを設定」を実行してください。');
}

/** ② 毎日23:30に dailyJob を実行するトリガーを設定 */
function installDailyTrigger() {
  removeDailyTrigger();
  var tzWarning = timeZoneWarning_();
  if (tzWarning) {
    showAlert_('タイムゾーンを直してから設定してください', tzWarning);
    return;
  }
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(23).nearMinute(30).everyDays(1).create();
  writeLog_('trigger', '正常', '毎日23:30のトリガーを設定しました');
  toast_('毎日23:30のトリガーを設定しました（Google側の仕様で実行時刻は±15分ほど前後します）。');
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
}

/** 毎日23:30にトリガーから呼ばれる本体 */
function dailyJob() {
  try {
    beginExecution_();
    // 当日だけでなく直近数日分を見直す（予定を後から書き足しても拾えるように）
    var today = new Date();
    prefetchCalendar_(today);
    var from = new Date(today.getTime());
    from.setDate(from.getDate() - (CONFIG.daily.lookbackDays - 1));
    runAnalysisForRange_(from, today);
  } catch (e) {
    writeLog_('daily', '警告', 'エラー: ' + e.message);
    throw e;
  }
}

/** 指定日の予定を取り込み、シートと集計を更新する */
function runAnalysisForDate_(date) {
  return runAnalysisForRange_(date, date);
}

/**
 * 指定期間の予定を取り込み、シートと集計を更新する
 */
function runAnalysisForRange_(startDate, endDate) {
  ensureSheets_();
  var run = importDateRange_(startDate, endDate);
  // シートに直接入力された答え合わせもここで拾う（スマホから入力しただけで済むように）
  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), run);
  writeSummarySheet_(snapshot);
  notify_(snapshot);
  return snapshot;
}

/**
 * 期間内の予定をカレンダーから取り込み、calendar_income_entries を更新する。
 * 同じ予定を再実行しても重複しない（カレンダーの予定ID＋日付をキーに上書きする）。
 */
function importDateRange_(startDate, endDate) {
  var start = new Date(startDate.getTime());
  start.setHours(0, 0, 0, 0);
  var last = new Date(endDate.getTime());
  last.setHours(0, 0, 0, 0);
  var days = Math.round((last.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days < 1) days = 1;
  if (days > 400) days = 400;
  var end = new Date(start.getTime());
  end.setDate(end.getDate() + days);

  var all = fetchWorkEntriesInRange_(start, end);
  all.days = days;
  all.from = formatDate_(start);
  all.to = formatDate_(new Date(end.getTime() - 24 * 60 * 60 * 1000));

  // 手入力で登録した同じ勤務があれば消す（カレンダーを正とする）
  removeSeededDuplicates_(all.entries);

  upsertRows_(SHEETS.CALENDAR, all.entries, 'id', function (existing, incoming) {
    var merged = {};
    Object.keys(incoming).forEach(function (k) {
      merged[k] = incoming[k];
    });
    // 給与明細と照合済みのフラグは再取り込みでも消さない
    merged.reconciled = toBool_(existing.reconciled);
    return merged;
  });

  ensureCompanyLimits_(
    all.entries.map(function (e) {
      return e.company_name;
    })
  );

  writeLog_(
    'import',
    all.errors.length > 0 ? '注意' : '正常',
    all.from + '〜' + all.to + ' 取り込み ' + all.entries.length + '件 / 対象外 ' + all.skipped + '件 / エラー ' + all.errors.length + '件'
  );
  return all;
}

/** 新しい勤務先を company_hour_limits に暫定値で登録する */
function ensureCompanyLimits_(companyNames) {
  var known = {};
  readTable_(SHEETS.LIMITS).rows.forEach(function (r) {
    known[String(r.company_name).trim()] = true;
  });
  var now = formatDateTime_(new Date());
  var added = [];
  companyNames.forEach(function (name) {
    var key = String(name).trim();
    if (!key || known[key]) return;
    known[key] = true;
    added.push({
      company_name: key,
      monthly_hour_limit: CONFIG.hours.defaultMonthlyLimit,
      confirmed: false,
      note: '暫定値。正社員の所定労働時間の回答が来たら実数に差し替える',
      updated_at: now
    });
  });
  appendRows_(SHEETS.LIMITS, added);
}

/* ------------------------- メニュー用 ------------------------- */

function runTodayFromMenu() {
  var snapshot = runAnalysisForDate_(new Date());
  showSummaryAlert_('今日の分析が完了しました', snapshot);
}

function refreshSummaryFromMenu() {
  ensureSheets_();
  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  showSummaryAlert_('サマリーを再計算しました', snapshot);
}

function backfillFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var from = ui.prompt('期間の取り込み', '開始日を yyyy-MM-dd で入力してください', ui.ButtonSet.OK_CANCEL);
  if (from.getSelectedButton() !== ui.Button.OK) return;
  var to = ui.prompt('期間の取り込み', '終了日を yyyy-MM-dd で入力してください', ui.ButtonSet.OK_CANCEL);
  if (to.getSelectedButton() !== ui.Button.OK) return;

  var start = parseDateInput_(from.getResponseText());
  var end = parseDateInput_(to.getResponseText());
  if (!start || !end) {
    ui.alert('日付は yyyy-MM-dd の形式で入力してください。');
    return;
  }
  if (start.getTime() > end.getTime()) {
    ui.alert('開始日が終了日より後になっています。');
    return;
  }

  ensureSheets_();
  var run = importDateRange_(start, end);
  var snapshot = buildSnapshot_(new Date(), run);
  writeSummarySheet_(snapshot);
  showSummaryAlert_(
    run.from + '〜' + run.to + ' を取り込みました（' + run.entries.length + '件 / エラー ' + run.errors.length + '件）',
    snapshot
  );
}

function addManualIncomeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var name = promptText_(ui, '手入力の収入', '収入元の名前（例: 〇〇業務委託）');
  if (name === null) return;
  var category = promptText_(
    ui,
    '手入力の収入',
    '区分を入力してください（' +
      INCOME_CATEGORY.SALARY +
      ' / ' +
      INCOME_CATEGORY.BUSINESS +
      ' / ' +
      INCOME_CATEGORY.MISC +
      '）'
  );
  if (category === null) return;
  var period = promptText_(ui, '手入力の収入', '対象期間（例: 2026-03 や 2026-03〜2026-05）※年が分かる形で');
  if (period === null) return;
  var amount = promptText_(ui, '手入力の収入', '金額（額面・円）');
  if (amount === null) return;
  var expenses = promptText_(ui, '手入力の収入', '必要経費（円）。無ければ 0');
  if (expenses === null) return;

  if (yearOfDateString_(period) === null) {
    ui.alert('対象期間から年が読み取れません（例: 2026-03）。もう一度登録してください。');
    return;
  }

  ensureSheets_();
  appendRows_(SHEETS.MANUAL, [
    {
      id: Utilities.getUuid(),
      source_name: name,
      income_category: category.trim() || INCOME_CATEGORY.BUSINESS,
      period: period,
      amount: toNumber_(amount),
      expenses: toNumber_(expenses),
      note: '',
      updated_at: formatDateTime_(new Date())
    }
  ]);
  refreshSummaryFromMenu();
}

function runTestsFromMenu() {
  var result = runTests();
  SpreadsheetApp.getUi().alert(result.summary + '\n\n' + result.details.join('\n'));
}

/* ------------------------- 小物 ------------------------- */

function promptText_(ui, title, message) {
  var res = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  return res.getResponseText();
}

function parseDateInput_(text) {
  var m = String(text || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  var year = Number(m[1]);
  var month = Number(m[2]);
  var day = Number(m[3]);
  var d = new Date(year, month - 1, day, 12, 0, 0);
  // 2026/8/32 のような存在しない日付は翌月に繰り上がるので弾く
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function toast_(message) {
  try {
    getSpreadsheet_().toast(message, '年収の壁ツール', 8);
  } catch (e) {
    Logger.log(message);
  }
}

function showAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title + '\n\n' + message);
  } catch (e) {
    Logger.log(title + '\n' + message);
  }
}

function showSummaryAlert_(title, snapshot) {
  try {
    SpreadsheetApp.getUi().alert(title + '\n\n' + buildNotificationText_(snapshot));
  } catch (e) {
    Logger.log(title + '\n' + buildNotificationText_(snapshot));
  }
}

/* ======================= Tests.js ======================= */

/**
 * セルフテスト（スプレッドシートに触らない純粋なロジックのみ）
 * GASのメニュー「セルフテストを実行」からも、ローカルの node からも実行できる。
 */

function runTests() {
  var details = [];
  var failed = 0;

  function check(name, actual, expected) {
    var a = JSON.stringify(actual);
    var e = JSON.stringify(expected);
    if (a === e) {
      details.push('OK   ' + name);
    } else {
      failed++;
      details.push('FAIL ' + name + ' : ' + a + ' != ' + e);
    }
  }

  /* --- タイトル解析 --- */
  var p1 = parseWorkEventTitle_('[Kakedas] 09:00-18:00 休憩1h 時給1226円');
  check('基本形: 会社名', p1.companyName, 'Kakedas');
  check('基本形: 時刻', [p1.startTime, p1.endTime], ['09:00', '18:00']);
  check('基本形: 休憩', p1.breakHours, 1);
  check('基本形: 時給', p1.hourlyWage, 1226);
  check('基本形: 警告なし', p1.warnings.length, 0);

  var p2 = parseWorkEventTitle_('[バイトレ] 13:00-17:00 休憩なし 時給1700円');
  check('休憩なし', [p2.ok, p2.breakHours, p2.hourlyWage], [true, 0, 1700]);

  var p3 = parseWorkEventTitle_('［Ｋａｋｅｄａｓ］ ０９：００−１８：００ 休憩１ｈ 時給１，２２６円');
  check('全角入力', [p3.ok, p3.companyName, p3.startTime, p3.endTime, p3.hourlyWage], [true, 'Kakedas', '09:00', '18:00', 1226]);

  check('休憩90分', parseWorkEventTitle_('[A] 09:00-18:00 休憩90分 時給1000円').breakHours, 1.5);
  check('休憩1時間30分', parseWorkEventTitle_('[A] 09:00-18:00 休憩1時間30分 時給1000円').breakHours, 1.5);
  check('休憩1.5h', parseWorkEventTitle_('[A] 09:00-18:00 休憩1.5h 時給1000円').breakHours, 1.5);
  check('休憩0.5h', parseWorkEventTitle_('[A] 09:00-18:00 休憩0.5h 時給1000円').breakHours, 0.5);
  check('休憩0分', parseWorkEventTitle_('[A] 09:00-18:00 休憩0分 時給1000円').breakHours, 0);
  check('波ダッシュ区切り', parseWorkEventTitle_('[A] 9:00〜18:00 休憩なし 時給1000円').startTime, '09:00');

  var p4 = parseWorkEventTitle_('[A] 09:00-18:00 時給1000円');
  check('休憩の記載なし: 0hで続行し警告', [p4.ok, p4.breakHours, p4.warnings.length], [true, 0, 1]);

  var p5 = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h');
  check('時給なし: エラー扱い', [p5.ok, p5.kind], [false, 'error']);

  var p6 = parseWorkEventTitle_('サークルの飲み会 19:00-22:00');
  check('[]なし: 勤務以外として無視', [p6.ok, p6.kind], [false, 'skip']);

  var p7 = parseWorkEventTitle_('[A] 休憩なし 時給1000円');
  check('タイトルに時刻なし: 予定の時刻を使う', [p7.ok, p7.hasTimeRange], [true, false]);

  /* --- 手当（単発バイトで出る固定額） --- */
  var al1 = parseWorkEventTitle_('[バイトレ] 09:00-17:00 休憩なし 時給1700円 手当1000円');
  check('手当: 基本形', [al1.ok, al1.allowance], [true, 1000]);
  check('手当: 交通費も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 交通費500円').allowance, 500);
  check('手当: 複数あれば合算', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当1000円 交通費500円').allowance, 1500);
  check('手当: 〇〇手当の形も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 食事手当800円').allowance, 800);
  check('手当: 日当も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 日当2000円').allowance, 2000);
  check('手当: プラス記号つき', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当+1,200円').allowance, 1200);
  check('手当: 手当なしは0', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当なし').allowance, 0);
  check('手当: 記載が無ければ0', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円').allowance, 0);
  check('手当: 全角でも拾う', parseWorkEventTitle_('［Ａ］ ０９：００−１７：００ 休憩なし 時給１０００円 手当１，０００円').allowance, 1000);
  check('手当: 時給と取り違えない', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当500円').hourlyWage, 1000);

  check('推定収入: 手当を足す', computeEstimatedAmount_(8, 1200, 1000), 8 * 1200 + 1000);
  check('推定収入: 手当が無くても従来どおり', computeEstimatedAmount_(8, 1200), 9600);
  check('推定収入: 手当だけの端数も四捨五入', computeEstimatedAmount_(0, 0, 1500), 1500);

  /* --- 支給額（残業などで時給×時間とずれた日を上書きする） --- */
  var fx1 = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給12000円');
  check('支給額: 基本形', [fx1.ok, fx1.hasFixedAmount, fx1.fixedAmount], [true, true, 12000]);
  check(
    '支給額: 「支給額」と書いてもよい',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給額12,500円').fixedAmount,
    12500
  );
  check(
    '支給額: 「合計」でも拾う',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 合計12500円').fixedAmount,
    12500
  );
  check(
    '支給額: 「給与」でも拾う',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 給与12500円').fixedAmount,
    12500
  );
  check(
    '支給額: 全角でも拾う',
    parseWorkEventTitle_('［Ａ］ ０９：００−１８：００ 休憩１ｈ 時給１２００円 支給１２，０００円').fixedAmount,
    12000
  );
  check(
    '支給額: 記載が無ければ使わない',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円').hasFixedAmount,
    false
  );
  check(
    '支給額: 時給を取り違えない',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給12000円').hourlyWage,
    1200
  );
  var fxBoth = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 交通費800円 支給12000円');
  check('支給額: 手当と併記したら手当は足さない', [fxBoth.fixedAmount, fxBoth.allowance], [12000, 0]);
  check('支給額: 手当と併記したら注意を出す', fxBoth.warnings.length, 1);

  check('推定収入: 支給額があればそれを使う', computeEstimatedAmount_(8, 1200, 1000, 12000), 12000);
  check('推定収入: 支給額が0なら計算どおり', computeEstimatedAmount_(8, 1200, 1000, 0), 8 * 1200 + 1000);

  var fixedRows = [
    { date: '2026-08-01', company_name: 'A', worked_hours: 8, estimated_amount: 12000, allowance: 0, fixed_amount: 12000 },
    { date: '2026-08-02', company_name: 'A', worked_hours: 8, estimated_amount: 9600, allowance: 0, fixed_amount: 0 }
  ];
  var withFixed = aggregateAnnual_(fixedRows, [], 2026);
  check('支給額: 年間の収入に反映される', withFixed.calendarRevenue, 21600);
  check('支給額: 手当合計には入れない', withFixed.allowanceTotal, 0);

  var allowanceRows = [
    { date: '2026-08-01', company_name: 'A', worked_hours: 8, estimated_amount: 10600, allowance: 1000 },
    { date: '2026-08-02', company_name: 'A', worked_hours: 8, estimated_amount: 9600, allowance: 0 }
  ];
  var withAllowance = aggregateAnnual_(allowanceRows, [], 2026);
  check('手当: 年間の収入に含まれる', withAllowance.calendarRevenue, 20200);
  check('手当: 手当だけの合計も出す', withAllowance.allowanceTotal, 1000);

  /* --- 実働時間・推定収入 --- */
  check('実働時間: 9:00-18:00 休憩1h', computeWorkedHours_('09:00', '18:00', 1), 8);
  check('実働時間: 13:00-17:00 休憩0', computeWorkedHours_('13:00', '17:00', 0), 4);
  check('実働時間: 日またぎ 22:00-06:00 休憩1h', computeWorkedHours_('22:00', '06:00', 1), 7);
  check('実働時間: 休憩が長すぎる場合は0', computeWorkedHours_('09:00', '10:00', 2), 0);
  check('実働時間: 不正な時刻はnull', computeWorkedHours_('あ', '10:00', 0), null);
  check('推定収入: 8h × 1226円', computeEstimatedAmount_(8, 1226), 9808);
  check('推定収入: 端数は四捨五入', computeEstimatedAmount_(7.5, 1015), 7613);

  /* --- 給与所得控除 --- */
  check('給与所得控除: 収入0', computeSalaryDeduction_(0), 0);
  check('給与所得控除: 収入40万（収入が上限）', computeSalaryDeduction_(400000), 400000);
  check('給与所得控除: 収入123万', computeSalaryDeduction_(1230000), 650000);
  check('給与所得控除: 収入200万', computeSalaryDeduction_(2000000), 680000);

  /* --- 年間集計 --- */
  var calRows = [
    { date: '2026-01-10', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 },
    { date: '2026-08-01', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 },
    { date: '2025-12-31', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 }
  ];
  var manualRows = [
    { source_name: '業務委託A', income_category: '事業所得', period: '2026-03〜2026-05', amount: 300000, expenses: 50000 },
    { source_name: '前職', income_category: '給与所得', period: '2026-02', amount: 100000, expenses: 0 },
    { source_name: '去年分', income_category: '事業所得', period: '2025-03', amount: 999999, expenses: 0 }
  ];
  var annual = aggregateAnnual_(calRows, manualRows, 2026);
  check('年間: カレンダー由来の給与収入', annual.calendarRevenue, 19616);
  check('年間: 給与収入合計', annual.salaryRevenue, 119616);
  check('年間: 事業収入', annual.businessRevenue, 300000);
  check('年間: 収入合計（壁の判定用）', annual.totalRevenue, 419616);
  check('年間: 給与所得（控除後・0未満にしない）', annual.salaryIncome, 0);
  check('年間: 事業所得（収入−経費）', annual.businessIncome, 250000);
  check('年間: 合計所得金額', annual.totalIncome, 250000);

  var badManual = aggregateAnnual_([], [{ source_name: 'X', income_category: '事業所得', period: '春ごろ', amount: 1 }], 2026);
  check('年間: periodに年が無い行は除外して警告', [badManual.totalRevenue, badManual.warnings.length], [0, 1]);

  /* --- 壁 --- */
  var wallRows = [
    { name: '123万円', amount: 1230000, applicable_year: 2026, last_updated: '2026-08-22', note: '' },
    { name: '130万円', amount: 1300000, applicable_year: 2026, last_updated: '2026-08-22', note: '' },
    { name: '旧年度の壁', amount: 1030000, applicable_year: 2025, last_updated: '2025-01-01', note: '' }
  ];
  var walls = evaluateWalls_(wallRows, 1000000, 2026);
  check('壁: 対象年のものだけ評価', walls.length, 2);
  check('壁: 123万円までの残り', walls[0].remaining, 230000);
  check('壁: 90%未満は正常', walls[0].status, '正常');
  check('壁: 90%以上は注意', evaluateWalls_(wallRows, 1150000, 2026)[0].status, '注意');
  check('壁: 超過は警告', evaluateWalls_(wallRows, 1300000, 2026)[0].status, '警告');
  check('壁: 超過分はマイナス表示', evaluateWalls_(wallRows, 1300000, 2026)[0].remaining, -70000);

  /* --- 月間労働時間 --- */
  var hourRows = [
    { date: '2026-08-01', company_name: 'Kakedas', worked_hours: 90, estimated_amount: 0 },
    { date: '2026-08-02', company_name: 'Kakedas', worked_hours: 6, estimated_amount: 0 },
    { date: '2026-08-03', company_name: 'バイトレ', worked_hours: 10, estimated_amount: 0 },
    { date: '2026-07-31', company_name: 'Kakedas', worked_hours: 100, estimated_amount: 0 }
  ];
  var limitRows = [{ company_name: 'Kakedas', monthly_hour_limit: 120, confirmed: false }];
  var hours = aggregateMonthlyHours_(hourRows, limitRows, '2026-08');
  check('時間: 会社ごとに当月分のみ集計', hours.length, 2);
  check('時間: Kakedasの当月実働', hours[0].hours, 96);
  check('時間: 80%到達で注意', hours[0].status, '注意');
  check('時間: 未登録の会社は暫定120hを適用', [hours[1].companyName, hours[1].limit, hours[1].status], ['バイトレ', 120, '正常']);
  var over = aggregateMonthlyHours_(
    [{ date: '2026-08-01', company_name: 'Kakedas', worked_hours: 120, estimated_amount: 0 }],
    limitRows,
    '2026-08'
  );
  check('時間: 100%到達で警告', over[0].status, '警告');

  /* --- 週の上限（正社員の週所定労働時間の4分の3） --- */
  check('週の開始日: 水曜日から月曜日', weekStartOf_('2026-08-19'), '2026-08-17');
  check('週の開始日: 月曜日はその日', weekStartOf_('2026-08-17'), '2026-08-17');
  check('週の開始日: 日曜日は同じ週の月曜', weekStartOf_('2026-08-23'), '2026-08-17');

  var weeklyLimitRows = [
    { company_name: 'リージェンシー', monthly_hour_limit: 130, weekly_hour_limit: 30, consecutive_months: 1, confirmed: true },
    { company_name: 'Kakedas', monthly_hour_limit: 120, weekly_hour_limit: 0, consecutive_months: 1, confirmed: false }
  ];
  var weeklyRows = [
    { date: '2026-08-17', company_name: 'リージェンシー', worked_hours: 8, estimated_amount: 0 },
    { date: '2026-08-19', company_name: 'リージェンシー', worked_hours: 8, estimated_amount: 0 },
    { date: '2026-08-21', company_name: 'リージェンシー', worked_hours: 9, estimated_amount: 0 },
    { date: '2026-08-21', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 0 }
  ];
  var weekly = aggregateWeeklyHours_(weeklyRows, weeklyLimitRows, new Date(2026, 7, 21, 12, 0), 2);
  check('週集計: 週上限のある勤務先だけ', weekly.map(function (w) { return w.companyName; }).join(','), 'リージェンシー,リージェンシー');
  var thisWeek = weekly.filter(function (w) { return w.isCurrentWeek; })[0];
  check('週集計: 今週の実働', [thisWeek.weekStart, thisWeek.hours, thisWeek.limit], ['2026-08-17', 25, 30]);
  check('週集計: 80%超で注意', thisWeek.status, '注意');
  check('週集計: 残り時間', thisWeek.remainingHours, 5);
  var overWeek = aggregateWeeklyHours_(
    weeklyRows.concat([{ date: '2026-08-22', company_name: 'リージェンシー', worked_hours: 6, estimated_amount: 0 }]),
    weeklyLimitRows,
    new Date(2026, 7, 21, 12, 0),
    1
  );
  check('週集計: 上限到達で警告', [overWeek[0].hours, overWeek[0].status], [31, '警告']);
  check('週集計: 週上限が無ければ対象外', aggregateWeeklyHours_(weeklyRows, [weeklyLimitRows[1]], new Date(2026, 7, 21), 2).length, 0);

  /* --- 連続月（月◯時間以上が◯ヶ月連続） --- */
  var beatLimits = [
    { company_name: 'ビート', monthly_hour_limit: 80, weekly_hour_limit: 0, consecutive_months: 2, confirmed: true },
    { company_name: 'Kakedas', monthly_hour_limit: 120, weekly_hour_limit: 0, consecutive_months: 1, confirmed: false }
  ];
  var quiet = evaluateConsecutiveMonths_(
    [{ date: '2026-08-01', company_name: 'ビート', worked_hours: 40, estimated_amount: 0 }],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 対象は連続月数2以上の勤務先だけ', quiet.length, 1);
  check('連続月: どちらも下回れば正常', quiet[0].status, '正常');

  var warned = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 40, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 先月だけ超えていたら注意', warned[0].status, '注意');
  check('連続月: 今月あと何時間で連続になるか示す', warned[0].message.indexOf('あと 40時間で2ヶ月連続') > 0, true);

  var alerted = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 82, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 2ヶ月連続で超えたら警告', alerted[0].status, '警告');
  check('連続月: 実績を並べて示す', alerted[0].message.indexOf('2026-07 85h / 2026-08 82h') > 0, true);

  var projected = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 60, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23),
    { 'ビート\t2026-08': 25 }
  );
  check('連続月: 予定を足した見込みでも判定できる', projected[0].status, '警告');

  /* --- 月次の答え合わせ --- */
  check('答え合わせ: 誤差が小さければOK', evaluateReconciliation_(100000, 101000).status, 'OK');
  check('答え合わせ: 率も額も超えたら要確認', evaluateReconciliation_(100000, 120000).status, '要確認');
  check('答え合わせ: 少額なら率が大きくてもOK', evaluateReconciliation_(10000, 12000).status, 'OK');

  /* --- 変換ユーティリティ --- */
  check('数値変換: カンマと円', toNumber_('1,226円'), 1226);
  check('数値変換: 空文字', toNumber_(''), 0);
  check('真偽変換', [toBool_(true), toBool_('TRUE'), toBool_('')], [true, true, false]);
  check('日付文字列の正規化', toDateString_('2026/8/1'), '2026-08-01');
  check('年月の取り出し', yearMonthOfDateString_('2026-08-01'), '2026-08');
  check('日付入力: 正しい日付', formatDate_(parseDateInput_('2026-08-20')), '2026-08-20');
  check('日付入力: 存在しない日付は拒否', parseDateInput_('2026/8/32'), null);
  check('日付入力: 形式違いは拒否', parseDateInput_('8月20日'), null);

  /* --- ロケール・タイムゾーン --- */
  check('時刻セル: 文字列はそのまま', toTimeString_('9:00'), '09:00');
  check('日付セル: 文字列はそのまま', toDateString_('2026/8/1'), '2026-08-01');

  var summary = failed === 0 ? 'セルフテスト: 全' + details.length + '件成功' : 'セルフテスト: ' + failed + '件失敗 / 全' + details.length + '件';
  return { summary: summary, details: details, failed: failed };
}

/* ======================= HTML（画面） ======================= */

INLINE_HTML["App"] = "<!DOCTYPE html>\n<html lang=\"ja\">\n  <head>\n    <base target=\"_top\" />\n    <style>\n      :root {\n        --bg: #f2f4f7;\n        --card: #ffffff;\n        --line: #e6e9ee;\n        --line-soft: #f0f2f5;\n        --text: #16191d;\n        --muted: #6b7280;\n        --faint: #9aa1ab;\n        --accent: #2563eb;\n        --accent-soft: #eff4ff;\n        --ok: #15803d;\n        --warn: #c2620a;\n        --alert: #c02626;\n        --ok-bg: #e9f7ee;\n        --warn-bg: #fdf3e4;\n        --alert-bg: #fdecea;\n        --ok-bar: #22a35a;\n        --warn-bar: #ec9013;\n        --alert-bar: #e0453b;\n        --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 4px 14px rgba(16, 24, 40, 0.06);\n        --shadow-lg: 0 2px 6px rgba(16, 24, 40, 0.07), 0 12px 32px rgba(16, 24, 40, 0.1);\n        --radius: 18px;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root {\n          --bg: #0f1216;\n          --card: #191d23;\n          --line: #2a3038;\n          --line-soft: #23282f;\n          --text: #e9edf2;\n          --muted: #9aa3ae;\n          --faint: #6f7883;\n          --accent: #6ea0ff;\n          --accent-soft: #1a2436;\n          --ok: #6ee7a0;\n          --warn: #fbbf4a;\n          --alert: #ff8f85;\n          --ok-bg: #16281d;\n          --warn-bg: #2e2617;\n          --alert-bg: #2f1d1c;\n          --ok-bar: #34c777;\n          --warn-bar: #eda23a;\n          --alert-bar: #f2695e;\n          --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);\n          --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.5);\n        }\n      }\n\n      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }\n      html { -webkit-text-size-adjust: 100%; }\n      body {\n        margin: 0;\n        padding: 0 0 calc(76px + env(safe-area-inset-bottom));\n        background: var(--bg);\n        color: var(--text);\n        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans',\n          'Noto Sans JP', 'Yu Gothic', sans-serif;\n        font-size: 15px;\n        line-height: 1.55;\n        -webkit-font-smoothing: antialiased;\n        overscroll-behavior-y: none;\n      }\n\n      /* ---------- ヘッダー ---------- */\n      header {\n        position: sticky; top: 0; z-index: 30;\n        background: color-mix(in srgb, var(--card) 88%, transparent);\n        backdrop-filter: saturate(1.6) blur(14px);\n        -webkit-backdrop-filter: saturate(1.6) blur(14px);\n        border-bottom: 1px solid var(--line);\n        padding: calc(10px + env(safe-area-inset-top)) 16px 10px;\n        display: flex; align-items: center; gap: 12px;\n      }\n      header .brand { flex: 1; min-width: 0; }\n      header h1 { font-size: 16px; margin: 0; letter-spacing: .01em; font-weight: 700; }\n      header .updated {\n        display: flex; align-items: center; gap: 5px;\n        font-size: 11px; color: var(--faint); font-weight: 400; margin-top: 1px;\n      }\n      .dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; background: var(--ok-bar); }\n      .dot.注意 { background: var(--warn-bar); }\n      .dot.警告 { background: var(--alert-bar); }\n      .spin {\n        width: 12px; height: 12px; flex: 0 0 auto;\n        border: 2px solid var(--line); border-top-color: var(--accent);\n        border-radius: 50%; animation: spin .7s linear infinite;\n      }\n      @keyframes spin { to { transform: rotate(360deg); } }\n      .icon-btn {\n        border: 1px solid var(--line); background: var(--card); color: var(--text);\n        border-radius: 999px; padding: 7px 15px; font-size: 13px; font-weight: 600;\n        cursor: pointer; flex: 0 0 auto; font-family: inherit;\n      }\n      .icon-btn:active { transform: scale(.96); }\n\n      main { padding: 14px 14px 0; max-width: 620px; margin: 0 auto; }\n      .view { display: none; animation: fade .22s ease; }\n      .view.active { display: block; }\n      @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }\n\n      /* ---------- カード ---------- */\n      .card {\n        background: var(--card);\n        border-radius: var(--radius);\n        padding: 16px;\n        margin-bottom: 12px;\n        box-shadow: var(--shadow);\n      }\n      .card > h2 {\n        font-size: 11px; color: var(--faint); margin: 0 0 12px;\n        font-weight: 700; letter-spacing: .08em; text-transform: none;\n      }\n      .card h3 { font-size: 15px; margin: 0; font-weight: 650; }\n\n      /* ---------- ヒーロー ---------- */\n      .hero {\n        background: linear-gradient(160deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 72%, #7c3aed) 100%);\n        color: #fff; border-radius: var(--radius); padding: 20px 18px;\n        margin-bottom: 12px; box-shadow: var(--shadow-lg);\n      }\n      .hero .label { font-size: 12px; opacity: .82; font-weight: 600; letter-spacing: .04em; }\n      .hero .amount { font-size: 34px; font-weight: 800; letter-spacing: -.025em; line-height: 1.15; margin-top: 2px; }\n      .hero .sub { font-size: 12px; opacity: .82; margin-top: 3px; }\n      .hero .split { display: flex; gap: 10px; margin-top: 16px; }\n      .hero .chip {\n        flex: 1; background: rgba(255,255,255,.16); border-radius: 12px;\n        padding: 9px 11px; min-width: 0;\n      }\n      .hero .chip .k { font-size: 10.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n      .hero .chip .v { font-size: 15px; font-weight: 700; margin-top: 1px; }\n\n      /* ---------- 数値・行 ---------- */\n      .big { font-size: 27px; font-weight: 750; letter-spacing: -.022em; line-height: 1.2; }\n      .big.neg { color: var(--alert); }\n      .sub { font-size: 12px; color: var(--muted); }\n      .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }\n      .row + .row { margin-top: 7px; }\n      .row .k { color: var(--muted); font-size: 13px; }\n      .row .v { font-variant-numeric: tabular-nums; font-size: 14px; }\n      .strong { font-weight: 750; }\n      .divider { border-top: 1px solid var(--line-soft); margin: 11px 0; }\n      .total { background: var(--accent-soft); margin: 11px -16px -16px; padding: 13px 16px;\n               border-radius: 0 0 var(--radius) var(--radius); }\n      .total .k { color: var(--text); font-weight: 650; font-size: 13px; }\n      .total .v { font-size: 16px; }\n\n      /* ---------- バッジ ---------- */\n      .badge {\n        display: inline-block; font-size: 11px; font-weight: 750;\n        padding: 3px 10px; border-radius: 999px; white-space: nowrap;\n      }\n      .s-正常 { color: var(--ok); background: var(--ok-bg); }\n      .s-注意 { color: var(--warn); background: var(--warn-bg); }\n      .s-警告, .s-要確認 { color: var(--alert); background: var(--alert-bg); }\n      .s-OK { color: var(--ok); background: var(--ok-bg); }\n      .s-情報, .s-INFO { color: var(--muted); background: var(--line-soft); }\n\n      /* ---------- バー ---------- */\n      .bar { height: 9px; border-radius: 999px; background: var(--line-soft); overflow: hidden; margin: 11px 0 7px; }\n      .bar > i { display: block; height: 100%; border-radius: 999px; transition: width .5s cubic-bezier(.2,.8,.2,1); }\n      .f-正常 { background: linear-gradient(90deg, var(--ok-bar), color-mix(in srgb, var(--ok-bar) 70%, #7ee0a8)); }\n      .f-注意 { background: linear-gradient(90deg, var(--warn-bar), color-mix(in srgb, var(--warn-bar) 70%, #ffd08a)); }\n      .f-警告 { background: linear-gradient(90deg, var(--alert-bar), color-mix(in srgb, var(--alert-bar) 70%, #ff9d95)); }\n\n      /* ---------- 壁カード ---------- */\n      .wall + .wall { margin-top: 6px; padding-top: 16px; border-top: 1px solid var(--line-soft); }\n      .wall .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }\n      .wall .name { font-size: 14px; font-weight: 700; }\n      .wall .rest { font-size: 23px; font-weight: 780; letter-spacing: -.02em; margin-top: 5px; }\n      .wall .rest.neg { color: var(--alert); }\n      .wall .meta { display: flex; justify-content: space-between; }\n\n      /* ---------- 一覧 ---------- */\n      ul.list { list-style: none; margin: 0; padding: 0; }\n      ul.list li { padding: 11px 0; border-top: 1px solid var(--line-soft); }\n      ul.list li:first-child { border-top: 0; padding-top: 2px; }\n      .empty { color: var(--faint); font-size: 13px; padding: 10px 0; text-align: center; }\n      .block + .block { margin-top: 17px; padding-top: 16px; border-top: 1px solid var(--line-soft); }\n\n      /* ---------- アドバイス ---------- */\n      .advice { display: flex; gap: 11px; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--line-soft); }\n      .advice:first-child { border-top: 0; padding-top: 0; }\n      .advice .badge { flex: 0 0 auto; margin-top: 1px; }\n      .advice div { font-size: 13.5px; line-height: 1.6; }\n\n      /* ---------- フォーム ---------- */\n      label { display: block; font-size: 12px; color: var(--muted); margin: 14px 0 5px; font-weight: 600; }\n      input, select, textarea {\n        width: 100%; padding: 11px 13px; font-size: 16px; color: var(--text);\n        background: var(--bg); border: 1px solid var(--line); border-radius: 12px;\n        font-family: inherit; appearance: none;\n      }\n      input:focus, select:focus, textarea:focus {\n        outline: none; border-color: var(--accent);\n        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);\n      }\n      select { background-image: none; }\n      button.primary {\n        width: 100%; margin-top: 16px; padding: 13px; font-size: 15px; font-weight: 700;\n        border: 0; border-radius: 12px; background: var(--accent); color: #fff;\n        cursor: pointer; font-family: inherit;\n      }\n      button.primary:active { transform: scale(.99); }\n      button.primary:disabled { opacity: .5; }\n      button.small {\n        padding: 9px 14px; font-size: 13px; font-weight: 650; border-radius: 10px;\n        border: 1px solid var(--line); background: var(--card); color: var(--text);\n        cursor: pointer; font-family: inherit; flex: 0 0 auto;\n      }\n      .inline { display: flex; gap: 9px; align-items: center; }\n      .inline input, .inline select { flex: 1; min-width: 0; }\n      .check { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 13px; color: var(--muted); }\n      .check input { width: 19px; height: 19px; flex: 0 0 auto; accent-color: var(--accent); }\n      a { color: var(--accent); text-decoration: none; font-weight: 600; }\n\n      .estimate {\n        background: var(--accent-soft); border-radius: 13px; padding: 13px 15px; margin-top: 14px;\n      }\n      .estimate .k { font-size: 11.5px; color: var(--muted); font-weight: 600; }\n      .estimate .v { font-size: 25px; font-weight: 780; letter-spacing: -.02em; margin-top: 1px; }\n\n      /* ---------- ナビ ---------- */\n      nav {\n        position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;\n        display: flex; background: color-mix(in srgb, var(--card) 92%, transparent);\n        backdrop-filter: saturate(1.6) blur(14px);\n        -webkit-backdrop-filter: saturate(1.6) blur(14px);\n        border-top: 1px solid var(--line);\n        padding-bottom: env(safe-area-inset-bottom);\n      }\n      nav button {\n        flex: 1; border: 0; background: transparent; color: var(--faint);\n        padding: 8px 0 9px; font-size: 10.5px; cursor: pointer; font-family: inherit;\n        font-weight: 650; position: relative; transition: color .18s;\n      }\n      nav button .ico { display: block; font-size: 19px; line-height: 1.35; filter: grayscale(1); opacity: .55; transition: all .18s; }\n      nav button.active { color: var(--accent); }\n      nav button.active .ico { filter: none; opacity: 1; transform: translateY(-1px); }\n\n      /* ---------- 通知など ---------- */\n      #toast {\n        position: fixed; left: 50%; bottom: calc(84px + env(safe-area-inset-bottom));\n        transform: translateX(-50%) translateY(10px);\n        background: #1f2328; color: #fff; padding: 12px 18px; border-radius: 13px;\n        font-size: 13px; max-width: 88%; z-index: 60; box-shadow: var(--shadow-lg);\n        opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;\n      }\n      #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }\n      #busy {\n        position: fixed; inset: 0; background: rgba(10, 12, 16, .3); z-index: 70;\n        display: none; align-items: center; justify-content: center;\n        backdrop-filter: blur(2px);\n      }\n      #busy.show { display: flex; }\n      #busy div {\n        background: var(--card); padding: 16px 24px; border-radius: 14px;\n        font-size: 14px; font-weight: 600; box-shadow: var(--shadow-lg);\n      }\n      .skeleton {\n        background: linear-gradient(90deg, var(--line-soft) 25%, var(--line) 37%, var(--line-soft) 63%);\n        background-size: 400% 100%; animation: shimmer 1.3s ease-in-out infinite;\n        border-radius: 8px; height: 13px;\n      }\n      @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }\n      .disclaimer {\n        font-size: 11px; color: var(--faint); line-height: 1.6;\n        padding: 16px 6px 24px; text-align: center;\n      }\n    </style>\n  </head>\n  <body>\n    <header>\n      <div class=\"brand\">\n        <h1>年収の壁</h1>\n        <span class=\"updated\" id=\"updated\"><span class=\"spin\"></span>読み込み中</span>\n      </div>\n      <button class=\"icon-btn\" id=\"reload\">更新</button>\n    </header>\n\n    <main>\n      <section class=\"view active\" id=\"view-home\"></section>\n      <section class=\"view\" id=\"view-income\"></section>\n      <section class=\"view\" id=\"view-forecast\"></section>\n      <section class=\"view\" id=\"view-reconcile\"></section>\n      <section class=\"view\" id=\"view-settings\"></section>\n      <div class=\"disclaimer\" id=\"disclaimer\"></div>\n    </main>\n\n    <nav>\n      <button data-view=\"home\" class=\"active\"><span class=\"ico\">🏠</span>ホーム</button>\n      <button data-view=\"income\"><span class=\"ico\">💴</span>収入</button>\n      <button data-view=\"forecast\"><span class=\"ico\">📅</span>見込み</button>\n      <button data-view=\"reconcile\"><span class=\"ico\">✅</span>照合</button>\n      <button data-view=\"settings\"><span class=\"ico\">⚙️</span>設定</button>\n    </nav>\n\n    <div id=\"toast\"></div>\n    <div id=\"busy\"><div>処理中…</div></div>\n\n    <script>\n      // 下のスクリプトが壊れても白い画面のまま放置しないための保険。\n      // 別の script ブロックに置くことで、後続ブロックの構文エラーも拾える。\n      window.addEventListener('error', function (event) {\n        var updated = document.getElementById('updated');\n        if (updated) updated.textContent = '表示エラー';\n        var home = document.getElementById('view-home');\n        if (home) {\n          home.innerHTML =\n            '<div class=\"card\"><h2>画面を表示できませんでした</h2><div class=\"sub\">' +\n            String(event.message || event.error || '不明なエラー') +\n            '</div><div class=\"sub\" style=\"margin-top:8px\">スプレッドシートのサマリータブからも同じ内容を確認できます。</div></div>';\n        }\n      });\n    </script>\n\n    <script>\n      // JSON はそのまま JavaScript のリテラルとして正しいので、文字列に包まず埋め込む。\n      // 文字列に包むと \\t や \\\" が JS 側で先に展開されてしまい、JSON.parse が壊れる。\n      var DATA = <?!= bootstrapJson ?>;\n\n      /* ---------- 小物 ---------- */\n      function esc(s) {\n        return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n        });\n      }\n      function yen(n) {\n        var v = Math.round(Number(n) || 0);\n        var sign = v < 0 ? '-' : '';\n        return sign + Math.abs(v).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + '円';\n      }\n      function pct(r) { return Math.round((Number(r) || 0) * 100) + '%'; }\n      function clamp(r) { return Math.max(0, Math.min(100, Math.round((Number(r) || 0) * 100))); }\n      function el(id) { return document.getElementById(id); }\n\n      function toast(msg) {\n        var t = el('toast');\n        t.textContent = msg;\n        t.classList.add('show');\n        clearTimeout(t._timer);\n        t._timer = setTimeout(function () { t.classList.remove('show'); }, 4200);\n      }\n      function busy(on) { el('busy').classList.toggle('show', on); }\n\n      function call(fnName, arg, onDone) {\n        busy(true);\n        var runner = google.script.run\n          .withSuccessHandler(function (res) {\n            busy(false);\n            if (res && res.data) DATA = res.data;\n            else if (res) DATA = res;\n            render();\n            if (onDone) onDone(res);\n            else if (res && res.message) toast(res.message);\n          })\n          .withFailureHandler(function (err) {\n            busy(false);\n            toast('エラー: ' + err.message);\n          });\n        if (arg === undefined) runner[fnName]();\n        else runner[fnName](arg);\n      }\n\n      function bar(ratio, status) {\n        return '<div class=\"bar\"><i class=\"f-' + esc(status) + '\" style=\"width:' + clamp(ratio) + '%\"></i></div>';\n      }\n      function card(title, inner) {\n        return '<div class=\"card\">' + (title ? '<h2>' + esc(title) + '</h2>' : '') + inner + '</div>';\n      }\n      function row(k, v, strong) {\n        return '<div class=\"row\"><span class=\"k\">' + esc(k) + '</span><span class=\"v' +\n          (strong ? ' strong' : '') + '\">' + v + '</span></div>';\n      }\n      function totalRow(k, v) {\n        return '<div class=\"total\"><div class=\"row\"><span class=\"k\">' + esc(k) +\n          '</span><span class=\"v strong\">' + v + '</span></div></div>';\n      }\n      function badge(status) {\n        return '<span class=\"badge s-' + esc(status) + '\">' + esc(status) + '</span>';\n      }\n\n      /* ---------- ホーム ---------- */\n      function renderHome() {\n        var d = DATA;\n        var html = '';\n\n        // 一番近い壁（残りが少ない順）をヒーローに出す\n        var nearest = (d.walls || []).slice().sort(function (a, b) { return a.remaining - b.remaining; })[0];\n        html +=\n          '<div class=\"hero\">' +\n          '<div class=\"label\">' + d.targetYear + '年の収入（額面）</div>' +\n          '<div class=\"amount\">' + yen(d.annual.totalRevenue) + '</div>' +\n          (nearest\n            ? '<div class=\"sub\">' + esc(nearest.name) + 'まで あと ' +\n              (nearest.remaining < 0 ? yen(-nearest.remaining) + ' 超過' : yen(nearest.remaining)) + '</div>'\n            : '') +\n          '<div class=\"split\">' +\n          '<div class=\"chip\"><div class=\"k\">給与</div><div class=\"v\">' + yen(d.annual.salaryRevenue) + '</div></div>' +\n          '<div class=\"chip\"><div class=\"k\">事業</div><div class=\"v\">' + yen(d.annual.businessRevenue) + '</div></div>' +\n          '<div class=\"chip\"><div class=\"k\">雑</div><div class=\"v\">' + yen(d.annual.miscRevenue) + '</div></div>' +\n          '</div></div>';\n\n        var wallsHtml = '';\n        (d.walls || []).forEach(function (w) {\n          var over = w.remaining < 0;\n          wallsHtml +=\n            '<div class=\"wall\">' +\n            '<div class=\"head\"><span class=\"name\">' + esc(w.name) + '</span>' + badge(w.status) + '</div>' +\n            '<div class=\"rest' + (over ? ' neg' : '') + '\">' +\n            (over ? '超過 ' : '') + yen(Math.abs(w.remaining)) + '</div>' +\n            bar(w.ratio, w.status) +\n            '<div class=\"meta\"><span class=\"sub\">' + yen(w.amount) + ' のうち ' + pct(w.ratio) + '</span>' +\n            '<span class=\"sub\">更新 ' + esc(w.lastUpdated) + '</span></div>' +\n            (w.note ? '<div class=\"sub\" style=\"margin-top:7px\">' + esc(w.note) + '</div>' : '') +\n            '</div>';\n        });\n        html += card('壁までの残り', wallsHtml || '<div class=\"empty\">壁が登録されていません</div>');\n\n        var hoursHtml = '';\n        if (!(d.hours || []).length) {\n          hoursHtml = '<div class=\"empty\">今月の勤務データはまだありません</div>';\n        } else {\n          d.hours.forEach(function (h, i) {\n            hoursHtml +=\n              '<div class=\"' + (i ? 'block' : '') + '\">' +\n              '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n              '<h3>' + esc(h.companyName) + '</h3>' + badge(h.status) + '</div>' +\n              bar(h.ratio, h.status) +\n              '<div class=\"row\"><span class=\"sub\">' + h.hours + ' / ' + h.limit + ' 時間（' + pct(h.ratio) + '）' +\n              (h.confirmed ? '' : ' ・暫定') + '</span>' +\n              '<span class=\"sub\">' + h.days + '日 ' + yen(h.amount) + '</span></div>' +\n              '</div>';\n          });\n        }\n        html += card('今月（' + esc(d.yearMonth) + '）の労働時間', hoursHtml);\n\n        var weekly = (d.weekly || []).filter(function (w) { return w.isCurrentWeek; });\n        if (weekly.length) {\n          var weeklyHtml = '';\n          weekly.forEach(function (w, i) {\n            weeklyHtml +=\n              '<div class=\"' + (i ? 'block' : '') + '\">' +\n              '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n              '<h3>' + esc(w.companyName) + '</h3>' + badge(w.status) + '</div>' +\n              bar(w.ratio, w.status) +\n              '<div class=\"row\"><span class=\"sub\">' + w.hours + ' / ' + w.limit + ' 時間</span>' +\n              '<span class=\"sub\">残り ' + w.remainingHours + 'h</span></div></div>';\n          });\n          html += card('今週（' + esc(weekly[0].weekStart) + ' 〜 ' + esc(weekly[0].weekEnd) + '）', weeklyHtml);\n        }\n\n        var consecutive = (d.consecutive || []).filter(function (c) { return c.requiredMonths >= 2; });\n        if (consecutive.length) {\n          var conHtml = '';\n          consecutive.forEach(function (c, i) {\n            conHtml +=\n              '<div class=\"' + (i ? 'block' : '') + '\">' +\n              '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n              '<h3>' + esc(c.companyName) + '</h3>' + badge(c.status) + '</div>' +\n              '<div class=\"sub\" style=\"margin-top:6px\">月' + c.limit + '時間以上が' + c.requiredMonths + 'ヶ月連続で対象</div>' +\n              '<div class=\"sub\" style=\"margin-top:3px\">' + c.months.map(function (m) {\n                return esc(m.yearMonth) + ' <b>' + m.hours + 'h</b>' + (m.over ? '（超）' : '');\n              }).join('　/　') + '</div>' +\n              (c.message ? '<div class=\"sub\" style=\"margin-top:7px\">' + esc(c.message) + '</div>' : '') +\n              '</div>';\n          });\n          html += card('連続月の判定', conHtml);\n        }\n\n        var listHtml = '';\n        if (!(d.recentEntries || []).length) {\n          listHtml = '<div class=\"empty\">まだ取り込まれた勤務がありません</div>';\n        } else {\n          listHtml = '<ul class=\"list\">';\n          d.recentEntries.forEach(function (e) {\n            listHtml +=\n              '<li><div class=\"row\"><span><b>' + esc(e.date.slice(5)) + '</b>　' + esc(e.companyName) +\n              (e.reconciled ? ' <span class=\"badge s-OK\">照合済</span>' : '') + '</span>' +\n              '<span class=\"v strong\">' + yen(e.amount) + '</span></div>' +\n              '<div class=\"sub\">' + esc(e.startTime) + '-' + esc(e.endTime) + '　' + e.workedHours + '時間' +\n              (e.allowance ? '　手当 ' + yen(e.allowance) : '') +\n              (e.fixedAmount ? '　<span class=\"badge s-INFO\">支給額</span>' : '') + '</div></li>';\n          });\n          listHtml += '</ul>';\n        }\n        html += card('直近の勤務', listHtml);\n\n        el('view-home').innerHTML = html;\n      }\n\n      /* ---------- 収入 ---------- */\n      function renderIncome() {\n        var a = DATA.annual;\n        var html = '';\n\n        html += card(\n          '年間収入（額面）　※源泉徴収前の総支給額',\n          row('給与収入（カレンダー）', yen(a.calendarRevenue)) +\n            (a.allowanceTotal ? row('　うち手当', yen(a.allowanceTotal)) : '') +\n            row('給与収入（手入力）', yen(a.manualSalaryRevenue)) +\n            row('事業収入', yen(a.businessRevenue)) +\n            row('雑収入', yen(a.miscRevenue)) +\n            totalRow('合計（壁の判定に使用）', yen(a.totalRevenue))\n        );\n\n        html += card(\n          '合計所得金額　※収入額とは別の数値',\n          row('給与所得', yen(a.salaryIncome)) +\n            '<div class=\"sub\">給与収入 ' + yen(a.salaryRevenue) + ' − 控除 ' + yen(a.salaryDeduction) + '</div>' +\n            '<div class=\"divider\"></div>' +\n            row('事業所得', yen(a.businessIncome)) +\n            '<div class=\"sub\">事業収入 ' + yen(a.businessRevenue) + ' − 経費 ' + yen(a.businessExpenses) + '</div>' +\n            '<div class=\"divider\"></div>' +\n            row('雑所得', yen(a.miscIncome)) +\n            totalRow('合計所得金額', yen(a.totalIncome))\n        );\n\n        var manualHtml = '';\n        if (!(DATA.manualEntries || []).length) {\n          manualHtml = '<div class=\"empty\">未登録です</div>';\n        } else {\n          manualHtml = '<ul class=\"list\">';\n          DATA.manualEntries.forEach(function (m) {\n            manualHtml +=\n              '<li><div class=\"row\"><span>' + esc(m.sourceName) + '</span><span class=\"v strong\">' + yen(m.amount) + '</span></div>' +\n              '<div class=\"sub\">' + esc(m.category) + '　' + esc(m.period) +\n              (m.expenses ? '　経費 ' + yen(m.expenses) : '') + '</div></li>';\n          });\n          manualHtml += '</ul>';\n        }\n        html += card('カレンダー外の収入', manualHtml);\n\n        var options = (DATA.categories || []).map(function (c) {\n          return '<option value=\"' + esc(c) + '\"' + (c === '事業所得' ? ' selected' : '') + '>' + esc(c) + '</option>';\n        }).join('');\n        html += card(\n          '収入を追加',\n          '<label for=\"mi-name\">収入元</label><input id=\"mi-name\" placeholder=\"例: 〇〇業務委託\" />' +\n            '<label for=\"mi-cat\">区分</label><select id=\"mi-cat\">' + options + '</select>' +\n            '<label for=\"mi-period\">対象期間（年が分かる形で）</label><input id=\"mi-period\" placeholder=\"例: 2026-03〜2026-05\" />' +\n            '<label for=\"mi-amount\">金額（額面・円）</label><input id=\"mi-amount\" type=\"number\" inputmode=\"numeric\" />' +\n            '<label for=\"mi-exp\">必要経費（円）</label><input id=\"mi-exp\" type=\"number\" inputmode=\"numeric\" value=\"0\" />' +\n            '<button class=\"primary\" id=\"mi-save\">登録する</button>'\n        );\n\n        el('view-income').innerHTML = html;\n        el('mi-save').addEventListener('click', function () {\n          call('appAddManualIncome', {\n            sourceName: el('mi-name').value,\n            category: el('mi-cat').value,\n            period: el('mi-period').value,\n            amount: el('mi-amount').value,\n            expenses: el('mi-exp').value\n          }, function (res) { toast(res.message); });\n        });\n      }\n\n      /* ---------- 見込み ---------- */\n      function renderForecast() {\n        var f = DATA.forecast || {};\n\n        if (f.pending) {\n          el('view-forecast').innerHTML = card(\n            'この先の見込み',\n            '<div class=\"skeleton\" style=\"width:70%\"></div>' +\n              '<div class=\"skeleton\" style=\"width:90%;margin-top:10px\"></div>' +\n              '<div class=\"skeleton\" style=\"width:55%;margin-top:10px\"></div>' +\n              '<div class=\"empty\" style=\"margin-top:14px\">カレンダーを読み込んでいます…</div>'\n          );\n          return;\n        }\n        if (!f.available) {\n          el('view-forecast').innerHTML = card('この先の見込み',\n            '<div class=\"empty\">' + esc(f.reason || 'まだ取得できていません') + '</div>');\n          return;\n        }\n\n        var html = '';\n        html +=\n          '<div class=\"hero\" style=\"background:linear-gradient(160deg,#0f766e,#0891b2)\">' +\n          '<div class=\"label\">この先' + f.days + '日の予定</div>' +\n          '<div class=\"amount\">' + f.plannedCount + '件 / ' + f.plannedHours + '時間</div>' +\n          '<div class=\"sub\">予定分の収入 ' + yen(f.plannedRevenue) + '　（' + esc(f.from) + ' 〜 ' + esc(f.to) + '）</div>' +\n          '</div>';\n\n        var adviceHtml = '';\n        if (!(f.advice || []).length) {\n          adviceHtml = '<div class=\"empty\">特にありません</div>';\n        } else {\n          f.advice.forEach(function (a) {\n            adviceHtml += '<div class=\"advice\">' + badge(a.level) + '<div>' + esc(a.text) + '</div></div>';\n          });\n        }\n        html += card('勤務調整のアドバイス', adviceHtml);\n\n        var monthsHtml = '';\n        if (!(f.months || []).length) {\n          monthsHtml = '<div class=\"empty\">この先の勤務予定はありません</div>';\n        } else {\n          f.months.forEach(function (m, i) {\n            monthsHtml +=\n              '<div class=\"' + (i ? 'block' : '') + '\">' +\n              '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n              '<h3>' + esc(m.companyName) + ' <span class=\"sub\">' + esc(m.yearMonth) + '</span></h3>' +\n              badge(m.status) + '</div>' +\n              bar(m.ratio, m.status) +\n              '<div class=\"row\"><span class=\"sub\">実績 ' + m.actualHours + 'h ＋ 予定 ' + m.plannedHours +\n              'h ＝ <b>' + m.projectedHours + 'h</b> / ' + m.limit + 'h</span>' +\n              '<span class=\"sub\">' + (m.overHours > 0 ? m.overHours + 'h 超過' : '余裕 ' + m.remainingHours + 'h') +\n              '</span></div></div>';\n          });\n        }\n        html += card('月間労働時間の見込み', monthsHtml);\n\n        var wallHtml = '';\n        (f.walls || []).forEach(function (w, i) {\n          wallHtml +=\n            '<div class=\"' + (i ? 'block' : '') + '\">' +\n            '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n            '<h3>' + esc(w.name) + '</h3>' + badge(w.status) + '</div>' +\n            bar(w.ratio, w.status) +\n            '<div class=\"row\"><span class=\"sub\">こなすと ' + yen(w.projectedRevenue) + '</span>' +\n            '<span class=\"sub\">' + (w.remaining < 0 ? yen(-w.remaining) + ' 超過' : '残り ' + yen(w.remaining)) +\n            '</span></div></div>';\n        });\n        html += card('予定を全部こなした場合', wallHtml);\n\n        if (f.pace && f.pace.available) {\n          html += card(\n            '年末の着地（目安・カレンダー分のみ）',\n            row('直近' + f.pace.months + 'ヶ月の平均', yen(f.pace.monthlyAverage) + ' / 月') +\n              row('年末までの残り', f.pace.remainingMonths + 'ヶ月') +\n              totalRow('年末見込み', yen(f.pace.yearEndEstimate)) +\n              (f.pace.reach\n                ? '<div class=\"sub\" style=\"margin-top:12px\">このペースだと ' + esc(f.pace.reach.wallName) +\n                  ' に ' + esc(f.pace.reach.yearMonth) + ' ごろ到達します。</div>'\n                : '')\n          );\n        }\n\n        el('view-forecast').innerHTML = html;\n      }\n\n      /* ---------- 照合 ---------- */\n      function renderReconcile() {\n        var form = DATA.reconcileForm;\n        var monthOpts = form.months.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('');\n        var compOpts = form.companies.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');\n\n        var html = card(\n          '月次の答え合わせ',\n          '<div class=\"sub\">給与明細の合計額（額面）を入れると、カレンダーからの推定額との差が出ます。</div>' +\n            '<label for=\"rc-month\">対象月</label><select id=\"rc-month\">' + monthOpts + '</select>' +\n            '<label for=\"rc-company\">勤務先</label><select id=\"rc-company\">' + compOpts + '</select>' +\n            '<div class=\"estimate\"><div class=\"k\">カレンダーからの推定額</div><div class=\"v\" id=\"rc-est\">-</div></div>' +\n            '<label for=\"rc-actual\">実際の支給額（額面・円）</label><input id=\"rc-actual\" type=\"number\" inputmode=\"numeric\" />' +\n            '<label for=\"rc-note\">メモ（任意）</label><input id=\"rc-note\" placeholder=\"交通費込み など\" />' +\n            '<button class=\"primary\" id=\"rc-save\">保存して差分を見る</button>'\n        );\n\n        var histHtml = '';\n        if (!(DATA.reconcileEntries || []).length) {\n          histHtml = '<div class=\"empty\">まだ入力がありません</div>';\n        } else {\n          histHtml = '<ul class=\"list\">';\n          DATA.reconcileEntries.forEach(function (r) {\n            histHtml +=\n              '<li><div class=\"row\"><span><b>' + esc(r.yearMonth) + '</b>　' + esc(r.companyName) + '</span>' +\n              badge(r.status) + '</div>' +\n              '<div class=\"sub\">推定 ' + yen(r.estimated) + '　実額 ' + yen(r.actual) + '　差分 ' + yen(r.diff) + '</div></li>';\n          });\n          histHtml += '</ul>';\n        }\n        html += card('履歴', histHtml);\n\n        el('view-reconcile').innerHTML = html;\n\n        function updateEstimate() {\n          var key = el('rc-month').value + '\\t' + el('rc-company').value;\n          var v = form.estimates[key];\n          el('rc-est').textContent = v === undefined ? '-' : yen(v);\n        }\n        el('rc-month').addEventListener('change', updateEstimate);\n        el('rc-company').addEventListener('change', updateEstimate);\n        updateEstimate();\n\n        el('rc-save').addEventListener('click', function () {\n          if (el('rc-actual').value === '') { toast('実際の支給額を入力してください'); return; }\n          call('appSaveReconciliation', {\n            yearMonth: el('rc-month').value,\n            companyName: el('rc-company').value,\n            actualAmount: el('rc-actual').value,\n            note: el('rc-note').value\n          }, function (res) { toast(res.result.message); });\n        });\n      }\n\n      /* ---------- 設定 ---------- */\n      function renderSettings() {\n        var html = '';\n        var limitsHtml = '';\n        if (!(DATA.limits || []).length) {\n          limitsHtml = '<div class=\"empty\">勤務先はカレンダーの取り込み時に自動登録されます</div>';\n        } else {\n          DATA.limits.forEach(function (l, i) {\n            limitsHtml +=\n              '<div class=\"' + (i ? 'block' : '') + '\">' +\n              '<div class=\"head\" style=\"display:flex;justify-content:space-between;align-items:center\">' +\n              '<h3>' + esc(l.companyName) + '</h3>' +\n              '<span class=\"badge s-' + (l.confirmed ? '正常\">確定' : '注意\">暫定') + '</span></div>' +\n              '<div class=\"inline\" style=\"margin-top:10px\">' +\n              '<input type=\"number\" inputmode=\"numeric\" id=\"lim-' + i + '\" value=\"' + l.limit + '\" />' +\n              '<span class=\"sub\">時間/月</span></div>' +\n              '<div class=\"inline\" style=\"margin-top:8px\">' +\n              '<input type=\"number\" inputmode=\"numeric\" id=\"wk-' + i + '\" value=\"' + (l.weeklyLimit || '') + '\" placeholder=\"未設定\" />' +\n              '<span class=\"sub\">時間/週</span></div>' +\n              '<div class=\"inline\" style=\"margin-top:8px\">' +\n              '<input type=\"number\" inputmode=\"numeric\" id=\"con-' + i + '\" value=\"' + (l.consecutiveMonths || 1) + '\" />' +\n              '<span class=\"sub\">ヶ月連続</span>' +\n              '<button class=\"small\" data-limit=\"' + i + '\">保存</button></div>' +\n              '<label class=\"check\"><input type=\"checkbox\" id=\"cfm-' + i + '\"' + (l.confirmed ? ' checked' : '') +\n              ' />会社から正式な回答をもらった</label>' +\n              (l.basis ? '<div class=\"sub\" style=\"margin-top:7px\">根拠：' + esc(l.basis) + '</div>' : '') +\n              '</div>';\n          });\n        }\n        html += card(\n          '勤務先ごとの上限（4分の3基準）',\n          '<div class=\"sub\" style=\"margin-bottom:14px\">週の上限は「正社員の週所定労働時間の4分の3」が示された場合に入れます（未設定なら判定しません）。' +\n            '連続月数は「月◯時間以上が◯ヶ月連続で対象」と言われた場合のみ変更します（通常は1）。</div>' + limitsHtml\n        );\n\n        html += card(\n          'カレンダーの取り込み',\n          '<div class=\"sub\">アプリを開くたびに直近1ヶ月分を自動で取り込みます。毎晩23:30にも実行されます。</div>' +\n            '<button class=\"primary\" id=\"run-today\">今日の分を取り込む</button>' +\n            '<label for=\"imp-date\">日付を指定して取り込み直す</label>' +\n            '<div class=\"inline\"><input id=\"imp-date\" placeholder=\"2026-08-20\" /><button class=\"small\" id=\"imp-run\">実行</button></div>'\n        );\n\n        html += card(\n          'データ',\n          '<div class=\"sub\">明細の修正や過去データの一括編集はスプレッドシートから行えます。</div>' +\n            '<div style=\"margin-top:12px\"><a href=\"' + esc(DATA.spreadsheetUrl) + '\" target=\"_blank\" rel=\"noopener\">スプレッドシートを開く →</a></div>' +\n            '<div class=\"sub\" style=\"margin-top:12px\">最終更新 ' + esc(DATA.generatedAt) + '</div>'\n        );\n\n        el('view-settings').innerHTML = html;\n\n        Array.prototype.forEach.call(document.querySelectorAll('[data-limit]'), function (btn) {\n          btn.addEventListener('click', function () {\n            var i = btn.getAttribute('data-limit');\n            call('appSaveCompanyLimit', {\n              companyName: DATA.limits[i].companyName,\n              limit: el('lim-' + i).value,\n              weeklyLimit: el('wk-' + i).value,\n              consecutiveMonths: el('con-' + i).value,\n              confirmed: el('cfm-' + i).checked\n            }, function (res) { toast(res.message); });\n          });\n        });\n        el('run-today').addEventListener('click', function () {\n          call('appRunToday', undefined, function () { toast('今日の予定を取り込みました'); });\n        });\n        el('imp-run').addEventListener('click', function () {\n          call('appImportDate', el('imp-date').value, function (res) {\n            toast(res.message);\n            if (res.errors && res.errors.length) toast(res.errors[0]);\n          });\n        });\n      }\n\n      /* ---------- 描画 ---------- */\n      function setStatus(text, spinning) {\n        var level = DATA && DATA.level ? DATA.level : '正常';\n        el('updated').innerHTML = spinning\n          ? '<span class=\"spin\"></span>' + esc(text)\n          : '<span class=\"dot ' + esc(level) + '\"></span>' + esc(text);\n      }\n\n      function render() {\n        if (DATA.error) {\n          el('view-home').innerHTML = card('エラー', '<div class=\"sub\">' + esc(DATA.error) + '</div>');\n          setStatus('エラー', false);\n          el('disclaimer').textContent = DATA.disclaimer || '';\n          return;\n        }\n        setStatus(DATA.generatedAt + '　' + DATA.level, false);\n        el('disclaimer').textContent = DATA.disclaimer;\n        renderHome();\n        renderIncome();\n        renderForecast();\n        renderReconcile();\n        renderSettings();\n      }\n\n      /* ---------- 表示後の同期 ---------- */\n      function syncCalendar(showToast) {\n        setStatus('カレンダーを確認中…', true);\n        google.script.run\n          .withSuccessHandler(function (data) {\n            DATA = data;\n            render();\n            if (showToast) toast('最新の状態にしました');\n          })\n          .withFailureHandler(function (err) {\n            setStatus('同期できませんでした', false);\n            toast('エラー: ' + err.message);\n          })\n          .appSyncCalendar();\n      }\n\n      Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (btn) {\n        btn.addEventListener('click', function () {\n          var view = btn.getAttribute('data-view');\n          Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {\n            b.classList.toggle('active', b === btn);\n          });\n          Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {\n            v.classList.toggle('active', v.id === 'view-' + view);\n          });\n          window.scrollTo(0, 0);\n        });\n      });\n\n      el('reload').addEventListener('click', function () { syncCalendar(true); });\n\n      render();\n      // 画面を出したあとにカレンダーを読む。ここを待つと表示が遅くなるため。\n      if (DATA.needsSync) syncCalendar(false);\n    </script>\n  </body>\n</html>\n";

INLINE_HTML["Reconcile"] = "<!DOCTYPE html>\n<html>\n  <head>\n    <base target=\"_top\" />\n    <style>\n      body {\n        font-family: -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;\n        font-size: 14px;\n        color: #222;\n        margin: 16px;\n      }\n      h2 { font-size: 16px; margin: 0 0 12px; }\n      label { display: block; margin: 12px 0 4px; font-weight: bold; }\n      select, input, textarea {\n        width: 100%; box-sizing: border-box; padding: 6px 8px;\n        border: 1px solid #ccc; border-radius: 4px; font-size: 14px;\n      }\n      .estimate { background: #eceff1; padding: 10px; border-radius: 4px; margin-top: 12px; }\n      .estimate strong { font-size: 18px; }\n      button {\n        margin-top: 16px; padding: 8px 16px; font-size: 14px; border: 0; border-radius: 4px;\n        background: #1a73e8; color: #fff; cursor: pointer;\n      }\n      button:disabled { background: #9e9e9e; cursor: default; }\n      #result { margin-top: 14px; padding: 10px; border-radius: 4px; display: none; white-space: pre-wrap; }\n      .ok { background: #e8f5e9; color: #1b5e20; }\n      .ng { background: #fff3e0; color: #bf360c; }\n      .disclaimer { margin-top: 18px; font-size: 11px; color: #666; border-top: 1px solid #ddd; padding-top: 10px; }\n    </style>\n  </head>\n  <body>\n    <h2>月次の答え合わせ</h2>\n    <p style=\"margin:0;color:#555\">給与明細・支給照会の合計額（額面）を入力してください。</p>\n\n    <label for=\"month\">対象月</label>\n    <select id=\"month\"></select>\n\n    <label for=\"company\">勤務先</label>\n    <select id=\"company\"></select>\n\n    <div class=\"estimate\">\n      カレンダーからの推定額（額面）<br />\n      <strong id=\"estimate\">-</strong>\n    </div>\n\n    <label for=\"actual\">実際の支給額（額面・円）</label>\n    <input id=\"actual\" type=\"number\" inputmode=\"numeric\" step=\"1\" placeholder=\"例: 98000\" />\n\n    <label for=\"note\">メモ（任意）</label>\n    <textarea id=\"note\" rows=\"2\" placeholder=\"交通費込み など\"></textarea>\n\n    <button id=\"save\" disabled>保存して差分を確認</button>\n    <div id=\"result\"></div>\n    <div class=\"disclaimer\" id=\"disclaimer\"></div>\n\n    <script>\n      var DATA = null;\n\n      function yen(n) {\n        return Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + '円';\n      }\n\n      function fillSelect(el, values) {\n        el.innerHTML = '';\n        values.forEach(function (v) {\n          var opt = document.createElement('option');\n          opt.value = v;\n          opt.textContent = v;\n          el.appendChild(opt);\n        });\n      }\n\n      function updateEstimate() {\n        if (!DATA) return;\n        var key = document.getElementById('month').value + '\\t' + document.getElementById('company').value;\n        var value = DATA.estimates[key];\n        document.getElementById('estimate').textContent = value === undefined ? '-' : yen(value);\n      }\n\n      function onData(data) {\n        DATA = data;\n        fillSelect(document.getElementById('month'), data.months);\n        fillSelect(document.getElementById('company'), data.companies);\n        document.getElementById('disclaimer').textContent = data.disclaimer;\n        document.getElementById('save').disabled = false;\n        updateEstimate();\n      }\n\n      function onSaved(res) {\n        var el = document.getElementById('result');\n        el.style.display = 'block';\n        el.className = res.status === 'OK' ? 'ok' : 'ng';\n        el.textContent =\n          '推定額 ' + yen(res.estimated) + '\\n実額 ' + yen(res.actual) + '\\n差分 ' + yen(res.diff) + '\\n\\n' + res.message;\n        document.getElementById('save').disabled = false;\n        updateEstimate();\n      }\n\n      function onError(err) {\n        var el = document.getElementById('result');\n        el.style.display = 'block';\n        el.className = 'ng';\n        el.textContent = 'エラー: ' + err.message;\n        document.getElementById('save').disabled = false;\n      }\n\n      document.getElementById('month').addEventListener('change', updateEstimate);\n      document.getElementById('company').addEventListener('change', updateEstimate);\n      document.getElementById('save').addEventListener('click', function () {\n        var actual = document.getElementById('actual').value;\n        if (actual === '') {\n          onError({ message: '実際の支給額を入力してください' });\n          return;\n        }\n        document.getElementById('save').disabled = true;\n        google.script.run\n          .withSuccessHandler(onSaved)\n          .withFailureHandler(onError)\n          .saveReconciliation({\n            yearMonth: document.getElementById('month').value,\n            companyName: document.getElementById('company').value,\n            actualAmount: actual,\n            note: document.getElementById('note').value\n          });\n      });\n\n      google.script.run.withSuccessHandler(onData).withFailureHandler(onError).getReconcileFormData();\n    </script>\n  </body>\n</html>\n";
