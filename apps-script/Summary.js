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

  // 給与は支給日が属する年の収入として数えるので、勤務先ごとの締め・支給日を先に用意する
  var holidays = holidayMap_();
  var resolvePayment = makePaymentResolver_(holidays);

  var annual = aggregateAnnual_(calendarRows, manualRows, targetYear, resolvePayment);
  var payments = aggregatePayments_(calendarRows, resolvePayment, today, targetYear);
  var walls = evaluateWalls_(wallRows, annual.totalRevenue, targetYear);
  var hours = aggregateMonthlyHours_(calendarRows, limitRows, yearMonth);
  var weekly = aggregateWeeklyHours_(calendarRows, limitRows, today);
  var consecutive = evaluateConsecutiveMonths_(calendarRows, limitRows, today);
  // 見込みはカレンダーを読むため時間がかかる。アプリの初回表示では飛ばして
  // 画面を先に出し、表示後の同期で埋める（options.skipForecast）。
  var forecast = options && options.skipForecast
    ? { available: false, pending: true, reason: '読み込み中です', advice: [] }
    : buildForecast_(calendarRows, limitRows, walls, annual, today, resolvePayment);

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
    payments: payments,
    holidaysAvailable: readStoredHolidays_().available,
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
