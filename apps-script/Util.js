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

/** セルの値を 'yyyy-MM-dd' 文字列へ正規化（Dateセル・文字列セルの両方に対応） */
function toDateString_(value) {
  if (value instanceof Date) return formatDate_(value);
  var s = String(value == null ? '' : value).trim();
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return s;
  return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
}

/** セルの値を 'HH:mm' 文字列へ正規化 */
function toTimeString_(value) {
  if (value instanceof Date) return formatTime_(value);
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

/** 集計対象年 */
function resolveTargetYear_(today) {
  if (CONFIG.targetYear) return CONFIG.targetYear;
  return Number(formatDate_(today).slice(0, 4));
}
