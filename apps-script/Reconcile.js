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
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    if (yearMonthOfDateString_(toDateString_(r.date)) !== yearMonth) return;
    if (companyName !== RECONCILE_ALL && String(r.company_name).trim() !== companyName) return;
    sheet.getRange(r._rowIndex, col).setValue(true);
  });
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
