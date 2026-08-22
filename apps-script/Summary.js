/** サマリーシートの作成と、通知本文の組み立て */

var SUMMARY_COLS = 6;

/** 各シートを読み込み、その時点の集計結果（スナップショット）を作る */
function buildSnapshot_(today, runInfo) {
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

  var messages = [];
  var tzWarning = timeZoneWarning_();
  if (tzWarning) messages.push(tzWarning);
  messages = messages.concat(annual.warnings);
  if (runInfo) {
    messages = messages.concat(runInfo.errors || []).concat(runInfo.warnings || []);
  }

  var level = '正常';
  walls.concat(hours).forEach(function (x) {
    if (x.status === '警告') level = '警告';
    else if (x.status === '注意' && level === '正常') level = '注意';
  });
  var openReconcile = reconcileRows.filter(function (r) {
    return String(r.status || '') === '要確認';
  });
  if (openReconcile.length > 0 && level === '正常') level = '注意';

  return {
    generatedAt: formatDateTime_(today),
    targetYear: targetYear,
    yearMonth: yearMonth,
    annual: annual,
    walls: walls,
    hours: hours,
    reconcileRows: reconcileRows,
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
