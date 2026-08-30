/**
 * 日本の祝日
 *
 * 支給日が休日にあたったときの前倒し判定に使う。
 * Googleが公開している「日本の祝日」カレンダーから取り込み、
 * スクリプトのプロパティに保存して使い回す。
 *
 * 画面表示のときはカレンダーに触らない（起動を遅くしないため）。
 * 保存済みのものが無い場合は土日だけで判定し、その旨を暫定として扱う。
 */

var HOLIDAY_PROP_KEY = 'JP_HOLIDAYS';
var HOLIDAY_CACHE = null;

function invalidateHolidayCache_() {
  HOLIDAY_CACHE = null;
}

/**
 * 保存済みの祝日を読む。カレンダーには触らない。
 * 戻り値: { map: {'yyyy-MM-dd': 名前}, years: [..], fetchedAt, available }
 */
function readStoredHolidays_() {
  if (HOLIDAY_CACHE) return HOLIDAY_CACHE;
  var empty = { map: {}, years: [], fetchedAt: '', available: false };
  var raw;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(HOLIDAY_PROP_KEY);
  } catch (e) {
    HOLIDAY_CACHE = empty;
    return empty;
  }
  if (!raw) {
    HOLIDAY_CACHE = empty;
    return empty;
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    HOLIDAY_CACHE = empty;
    return empty;
  }
  HOLIDAY_CACHE = {
    map: parsed.map || {},
    years: parsed.years || [],
    fetchedAt: parsed.fetchedAt || '',
    available: Object.keys(parsed.map || {}).length > 0
  };
  return HOLIDAY_CACHE;
}

/** 祝日の取り込みが必要か（対象の年が入っていない、または古い） */
function holidaysNeedRefresh_(today) {
  var stored = readStoredHolidays_();
  if (!stored.available) return true;
  var year = today.getFullYear();
  // 年をまたぐ支給日も判定するので、翌年分まで持っておく
  if (stored.years.indexOf(year) < 0 || stored.years.indexOf(year + 1) < 0) return true;
  if (!stored.fetchedAt) return true;
  var age = (today.getTime() - new Date(stored.fetchedAt).getTime()) / (24 * 60 * 60 * 1000);
  return !(age >= 0) || age > CONFIG.holidays.refreshDays;
}

/**
 * 祝日カレンダーから取り込んで保存する。カレンダーを1回読む。
 * 画面表示ではなく、カレンダー同期・毎晩の実行からのみ呼ぶこと。
 */
function refreshHolidays_(today, force) {
  if (!force && !holidaysNeedRefresh_(today)) return readStoredHolidays_();
  var calendar;
  try {
    calendar = CalendarApp.getCalendarById(CONFIG.holidays.calendarId);
  } catch (e) {
    calendar = null;
  }
  if (!calendar) return readStoredHolidays_();

  var year = today.getFullYear();
  var years = [year - 1, year, year + 1];
  var map = {};
  try {
    var events = calendar.getEvents(new Date(years[0], 0, 1), new Date(years[2] + 1, 0, 1));
    events.forEach(function (event) {
      map[formatDate_(event.getStartTime())] = event.getTitle();
    });
  } catch (e) {
    return readStoredHolidays_();
  }
  if (!Object.keys(map).length) return readStoredHolidays_();

  // 設定に手で足した休業日（会社独自の休みなど）も混ぜる
  (CONFIG.holidays.extra || []).forEach(function (d) {
    map[String(d)] = '設定で追加';
  });

  var payload = { map: map, years: years, fetchedAt: formatDateTime_(today) };
  try {
    PropertiesService.getScriptProperties().setProperty(HOLIDAY_PROP_KEY, JSON.stringify(payload));
  } catch (e) {
    // 保存できなくても、この実行の中では使えるようにする
  }
  HOLIDAY_CACHE = { map: map, years: years, fetchedAt: payload.fetchedAt, available: true };
  return HOLIDAY_CACHE;
}

/** 判定に使う祝日表（保存済みのもの。無ければ空） */
function holidayMap_() {
  return readStoredHolidays_().map;
}

/** メニューから手動で取り込み直す */
function refreshHolidaysFromMenu_() {
  invalidateHolidayCache_();
  var result = refreshHolidays_(new Date(), true);
  showAlert_(
    result.available ? '祝日を取り込みました' : '祝日を取り込めませんでした',
    result.available
      ? '対象年: ' + result.years.join('・') + '\n登録数: ' + Object.keys(result.map).length + '件'
      : 'Googleの「日本の祝日」カレンダーを読めませんでした。しばらく待ってからもう一度お試しください。' +
          '取り込めていない間は、支給日の調整は土日のみで判定します。'
  );
}
