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
        estimated_amount: computeEstimatedAmount_(workedHours, parsed.hourlyWage, parsed.allowance),
        reconciled: false,
        source_title: title,
        updated_at: now,
        allowance: parsed.allowance
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
        estimated_amount: computeEstimatedAmount_(workedHours, parsed.hourlyWage, parsed.allowance)
      });
    });
  });

  result.entries.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  return result;
}
