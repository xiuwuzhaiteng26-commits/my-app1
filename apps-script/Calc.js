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

/** その日の推定収入（額面） = 実働時間 × 時給。円未満は四捨五入 */
function computeEstimatedAmount_(workedHours, hourlyWage) {
  return Math.round(Number(workedHours || 0) * Number(hourlyWage || 0));
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
  var manualSalaryRevenue = 0;
  var business = { revenue: 0, expenses: 0 };
  var misc = { revenue: 0, expenses: 0 };
  var warnings = [];

  calendarRows.forEach(function (r) {
    var year = yearOfDateString_(toDateString_(r.date));
    if (year !== targetYear) return;
    calendarRevenue += toNumber_(r.estimated_amount);
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
