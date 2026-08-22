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
  var limits = {};
  limitRows.forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (!name) return;
    limits[name] = {
      limit: toNumber_(r.monthly_hour_limit) || CONFIG.hours.defaultMonthlyLimit,
      confirmed: toBool_(r.confirmed)
    };
  });

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
      var info = limits[companyName] || { limit: CONFIG.hours.defaultMonthlyLimit, confirmed: false };
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
