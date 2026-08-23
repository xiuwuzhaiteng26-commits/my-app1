/** Google カレンダーから、その日（0:00〜23:59）の勤務予定を取り出す */

/**
 * CONFIG.calendarIds に列挙された全カレンダーを解決する。
 * 見つからない/読めないカレンダーはエラーを添えて返す（他のカレンダーの取り込みは止めない）。
 */
function getTargetCalendars_() {
  var ids = CONFIG.calendarIds && CONFIG.calendarIds.length ? CONFIG.calendarIds : ['primary'];
  return ids.map(function (rawId) {
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
      events = source.calendar.getEvents(startDate, endDate);
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
        estimated_amount: computeEstimatedAmount_(workedHours, parsed.hourlyWage),
        reconciled: false,
        source_title: title,
        updated_at: now
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
      events = source.calendar.getEvents(startDate, endDate);
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
        estimated_amount: computeEstimatedAmount_(workedHours, parsed.hourlyWage)
      });
    });
  });

  result.entries.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  return result;
}
