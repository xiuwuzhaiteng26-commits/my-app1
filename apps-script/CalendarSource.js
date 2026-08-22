/** Google カレンダーから、その日（0:00〜23:59）の勤務予定を取り出す */

function getTargetCalendar_() {
  var calendar =
    !CONFIG.calendarId || CONFIG.calendarId === 'primary'
      ? CalendarApp.getDefaultCalendar()
      : CalendarApp.getCalendarById(CONFIG.calendarId);
  if (!calendar) {
    throw new Error('カレンダーが見つかりません: ' + CONFIG.calendarId);
  }
  return calendar;
}

/**
 * 指定日の予定を解析して勤務データにする。
 * 戻り値: { dateStr, entries[], skipped, errors[], warnings[] }
 */
function fetchWorkEntriesForDate_(date) {
  var dateStr = formatDate_(date);
  var events = getTargetCalendar_().getEventsForDay(date);
  var result = { dateStr: dateStr, entries: [], skipped: 0, errors: [], warnings: [] };
  var now = formatDateTime_(new Date());

  events.forEach(function (event) {
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
      startTime = formatTime_(event.getStartTime());
      endTime = formatTime_(event.getEndTime());
      result.warnings.push(
        dateStr + ' 「' + title + '」: タイトルに時刻が無いため予定の時刻（' + startTime + '-' + endTime + '）を使いました'
      );
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
      id: event.getId() + '#' + dateStr,
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

  return result;
}
