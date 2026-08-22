/**
 * エントリポイント（メニュー・毎日の実行・トリガー設定）
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('年収の壁ツール')
    .addItem('① 初期セットアップ（シート作成）', 'setupSheets')
    .addItem('② 毎日23:30のトリガーを設定', 'installDailyTrigger')
    .addItem('③ アプリのURLを表示', 'showWebAppUrl')
    .addSeparator()
    .addItem('今日の分析をいま実行', 'runTodayFromMenu')
    .addItem('期間を指定して取り込み直す', 'backfillFromMenu')
    .addItem('サマリーだけ再計算', 'refreshSummaryFromMenu')
    .addSeparator()
    .addItem('実データを取り込む（初回のみ）', 'importSeedData')
    .addSeparator()
    .addItem('月次の答え合わせを入力', 'openReconcileDialog')
    .addItem('月次の答え合わせを再計算', 'recalcReconciliationsFromMenu')
    .addItem('手入力の収入を追加', 'addManualIncomeFromMenu')
    .addSeparator()
    .addItem('トリガーを解除', 'removeDailyTrigger')
    .addItem('セルフテストを実行', 'runTestsFromMenu')
    .addToUi();
}

/** ① 初期セットアップ */
function setupSheets() {
  ensureSheets_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  writeLog_('setup', '正常', 'シートを初期化しました');
  var tzWarning = timeZoneWarning_();
  if (tzWarning) {
    showAlert_('設定を確認してください', tzWarning);
    return;
  }
  toast_('シートを作成しました。次に「② 毎日23:30のトリガーを設定」を実行してください。');
}

/** ② 毎日23:30に dailyJob を実行するトリガーを設定 */
function installDailyTrigger() {
  removeDailyTrigger();
  var tzWarning = timeZoneWarning_();
  if (tzWarning) {
    showAlert_('タイムゾーンを直してから設定してください', tzWarning);
    return;
  }
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(23).nearMinute(30).everyDays(1).create();
  writeLog_('trigger', '正常', '毎日23:30のトリガーを設定しました');
  toast_('毎日23:30のトリガーを設定しました（Google側の仕様で実行時刻は±15分ほど前後します）。');
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
}

/** 毎日23:30にトリガーから呼ばれる本体 */
function dailyJob() {
  try {
    runAnalysisForDate_(new Date());
  } catch (e) {
    writeLog_('daily', '警告', 'エラー: ' + e.message);
    throw e;
  }
}

/**
 * 指定日の予定を取り込み、シートと集計を更新する
 */
function runAnalysisForDate_(date) {
  ensureSheets_();
  var run = importDateRange_(date, date);
  // シートに直接入力された答え合わせもここで拾う（スマホから入力しただけで済むように）
  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), run);
  writeSummarySheet_(snapshot);
  notify_(snapshot);
  return snapshot;
}

/**
 * 期間内の予定をカレンダーから取り込み、calendar_income_entries を更新する。
 * 同じ予定を再実行しても重複しない（カレンダーの予定ID＋日付をキーに上書きする）。
 */
function importDateRange_(startDate, endDate) {
  var all = { entries: [], skipped: 0, errors: [], warnings: [], days: 0, from: '', to: '' };
  var cursor = new Date(startDate.getTime());
  cursor.setHours(12, 0, 0, 0); // 夏時間・日付境界の影響を避ける
  var last = new Date(endDate.getTime());
  last.setHours(12, 0, 0, 0);

  var guard = 0;
  while (cursor.getTime() <= last.getTime() && guard < 400) {
    var day = fetchWorkEntriesForDate_(cursor);
    all.entries = all.entries.concat(day.entries);
    all.skipped += day.skipped;
    all.errors = all.errors.concat(day.errors);
    all.warnings = all.warnings.concat(day.warnings);
    if (all.days === 0) all.from = day.dateStr;
    all.to = day.dateStr;
    all.days++;
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }

  // 手入力で登録した同じ勤務があれば消す（カレンダーを正とする）
  removeSeededDuplicates_(all.entries);

  upsertRows_(SHEETS.CALENDAR, all.entries, 'id', function (existing, incoming) {
    var merged = {};
    Object.keys(incoming).forEach(function (k) {
      merged[k] = incoming[k];
    });
    // 給与明細と照合済みのフラグは再取り込みでも消さない
    merged.reconciled = toBool_(existing.reconciled);
    return merged;
  });

  ensureCompanyLimits_(
    all.entries.map(function (e) {
      return e.company_name;
    })
  );

  writeLog_(
    'import',
    all.errors.length > 0 ? '注意' : '正常',
    all.from + '〜' + all.to + ' 取り込み ' + all.entries.length + '件 / 対象外 ' + all.skipped + '件 / エラー ' + all.errors.length + '件'
  );
  return all;
}

/** 新しい勤務先を company_hour_limits に暫定値で登録する */
function ensureCompanyLimits_(companyNames) {
  var known = {};
  readTable_(SHEETS.LIMITS).rows.forEach(function (r) {
    known[String(r.company_name).trim()] = true;
  });
  var now = formatDateTime_(new Date());
  var added = [];
  companyNames.forEach(function (name) {
    var key = String(name).trim();
    if (!key || known[key]) return;
    known[key] = true;
    added.push({
      company_name: key,
      monthly_hour_limit: CONFIG.hours.defaultMonthlyLimit,
      confirmed: false,
      note: '暫定値。正社員の所定労働時間の回答が来たら実数に差し替える',
      updated_at: now
    });
  });
  appendRows_(SHEETS.LIMITS, added);
}

/* ------------------------- メニュー用 ------------------------- */

function runTodayFromMenu() {
  var snapshot = runAnalysisForDate_(new Date());
  showSummaryAlert_('今日の分析が完了しました', snapshot);
}

function refreshSummaryFromMenu() {
  ensureSheets_();
  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);
  showSummaryAlert_('サマリーを再計算しました', snapshot);
}

function backfillFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var from = ui.prompt('期間の取り込み', '開始日を yyyy-MM-dd で入力してください', ui.ButtonSet.OK_CANCEL);
  if (from.getSelectedButton() !== ui.Button.OK) return;
  var to = ui.prompt('期間の取り込み', '終了日を yyyy-MM-dd で入力してください', ui.ButtonSet.OK_CANCEL);
  if (to.getSelectedButton() !== ui.Button.OK) return;

  var start = parseDateInput_(from.getResponseText());
  var end = parseDateInput_(to.getResponseText());
  if (!start || !end) {
    ui.alert('日付は yyyy-MM-dd の形式で入力してください。');
    return;
  }
  if (start.getTime() > end.getTime()) {
    ui.alert('開始日が終了日より後になっています。');
    return;
  }

  ensureSheets_();
  var run = importDateRange_(start, end);
  var snapshot = buildSnapshot_(new Date(), run);
  writeSummarySheet_(snapshot);
  showSummaryAlert_(
    run.from + '〜' + run.to + ' を取り込みました（' + run.entries.length + '件 / エラー ' + run.errors.length + '件）',
    snapshot
  );
}

function addManualIncomeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var name = promptText_(ui, '手入力の収入', '収入元の名前（例: 〇〇業務委託）');
  if (name === null) return;
  var category = promptText_(
    ui,
    '手入力の収入',
    '区分を入力してください（' +
      INCOME_CATEGORY.SALARY +
      ' / ' +
      INCOME_CATEGORY.BUSINESS +
      ' / ' +
      INCOME_CATEGORY.MISC +
      '）'
  );
  if (category === null) return;
  var period = promptText_(ui, '手入力の収入', '対象期間（例: 2026-03 や 2026-03〜2026-05）※年が分かる形で');
  if (period === null) return;
  var amount = promptText_(ui, '手入力の収入', '金額（額面・円）');
  if (amount === null) return;
  var expenses = promptText_(ui, '手入力の収入', '必要経費（円）。無ければ 0');
  if (expenses === null) return;

  if (yearOfDateString_(period) === null) {
    ui.alert('対象期間から年が読み取れません（例: 2026-03）。もう一度登録してください。');
    return;
  }

  ensureSheets_();
  appendRows_(SHEETS.MANUAL, [
    {
      id: Utilities.getUuid(),
      source_name: name,
      income_category: category.trim() || INCOME_CATEGORY.BUSINESS,
      period: period,
      amount: toNumber_(amount),
      expenses: toNumber_(expenses),
      note: '',
      updated_at: formatDateTime_(new Date())
    }
  ]);
  refreshSummaryFromMenu();
}

function runTestsFromMenu() {
  var result = runTests();
  SpreadsheetApp.getUi().alert(result.summary + '\n\n' + result.details.join('\n'));
}

/* ------------------------- 小物 ------------------------- */

function promptText_(ui, title, message) {
  var res = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  return res.getResponseText();
}

function parseDateInput_(text) {
  var m = String(text || '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  var year = Number(m[1]);
  var month = Number(m[2]);
  var day = Number(m[3]);
  var d = new Date(year, month - 1, day, 12, 0, 0);
  // 2026/8/32 のような存在しない日付は翌月に繰り上がるので弾く
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function toast_(message) {
  try {
    getSpreadsheet_().toast(message, '年収の壁ツール', 8);
  } catch (e) {
    Logger.log(message);
  }
}

function showAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title + '\n\n' + message);
  } catch (e) {
    Logger.log(title + '\n' + message);
  }
}

function showSummaryAlert_(title, snapshot) {
  try {
    SpreadsheetApp.getUi().alert(title + '\n\n' + buildNotificationText_(snapshot));
  } catch (e) {
    Logger.log(title + '\n' + buildNotificationText_(snapshot));
  }
}
