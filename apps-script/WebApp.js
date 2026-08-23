/**
 * ウェブアプリ（スマホから開く画面）
 *
 * 「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」で公開すると、
 * https://script.google.com/macros/s/.../exec のURLで開けるようになる。
 * スマホのホーム画面に追加すればアプリのように使える。
 *
 * 公開設定は「次のユーザーとして実行: 自分」「アクセスできるユーザー: 自分のみ」にすること。
 * （収入情報を扱うので、他人がURLを知っても開けないようにする）
 */

function doGet() {
  var template = htmlTemplate_('App');
  var payload;
  try {
    ensureSheets_();
    autoImportRecent_();
    payload = buildAppData_();
  } catch (e) {
    payload = { error: e.message, disclaimer: CONFIG.disclaimer };
  }
  // </script> でタグを閉じられないように < をエスケープしてから埋め込む
  template.bootstrapJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  // addMetaTag で指定できるのは viewport / mobile-web-app-capable /
  // apple-mobile-web-app-capable / google-site-verification の4つだけ。
  // それ以外を渡すと「指定したメタタグはこのコンテキストでは使用できません」で落ちる。
  // ホーム画面に追加したときの名前は setTitle の値が使われる。
  return template
    .evaluate()
    .setTitle('年収の壁')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/**
 * 直近数日のカレンダーをその場で取り込む。
 * 画面を開いた時点の内容にするためのもので、失敗しても画面表示は止めない。
 */
function autoImportRecent_() {
  var days = CONFIG.app.autoImportDays;
  if (!days) return null;
  try {
    var today = new Date();
    var from = new Date(today.getTime());
    from.setDate(from.getDate() - (days - 1));
    return importDateRange_(from, today);
  } catch (e) {
    writeLog_('app', '注意', 'アプリ表示時の取り込みに失敗しました: ' + e.message);
    return null;
  }
}

/** 画面に表示するデータ一式 */
function buildAppData_() {
  var now = new Date();
  var snapshot = buildSnapshot_(now, null);
  var a = snapshot.annual;

  var calendarRows = readTable_(SHEETS.CALENDAR).rows;
  var recent = calendarRows
    .map(function (r) {
      return {
        date: toDateString_(r.date),
        companyName: String(r.company_name || ''),
        startTime: toTimeString_(r.start_time),
        endTime: toTimeString_(r.end_time),
        workedHours: toNumber_(r.worked_hours),
        amount: toNumber_(r.estimated_amount),
        reconciled: toBool_(r.reconciled)
      };
    })
    .sort(function (x, y) {
      return x.date < y.date ? 1 : x.date > y.date ? -1 : 0;
    })
    .slice(0, 12);

  var limits = readTable_(SHEETS.LIMITS).rows.map(function (r) {
    return {
      companyName: String(r.company_name || ''),
      limit: toNumber_(r.monthly_hour_limit) || CONFIG.hours.defaultMonthlyLimit,
      confirmed: toBool_(r.confirmed),
      note: String(r.note || '')
    };
  });

  var manual = readTable_(SHEETS.MANUAL).rows.map(function (r) {
    return {
      sourceName: String(r.source_name || ''),
      category: String(r.income_category || ''),
      period: String(r.period || ''),
      amount: toNumber_(r.amount),
      expenses: toNumber_(r.expenses)
    };
  });

  var reconcile = readTable_(SHEETS.RECONCILE)
    .rows.map(function (r) {
      return {
        yearMonth: String(r.year_month || ''),
        companyName: String(r.company_name || ''),
        estimated: toNumber_(r.estimated_amount),
        actual: toNumber_(r.actual_amount),
        diff: toNumber_(r.diff),
        status: String(r.status || '')
      };
    })
    .reverse()
    .slice(0, 8);

  return {
    generatedAt: snapshot.generatedAt,
    targetYear: snapshot.targetYear,
    yearMonth: snapshot.yearMonth,
    level: snapshot.level,
    walls: snapshot.walls.map(function (w) {
      return {
        name: w.name,
        amount: w.amount,
        remaining: w.remaining,
        ratio: w.ratio,
        status: w.status,
        lastUpdated: w.lastUpdated,
        note: w.note
      };
    }),
    hours: snapshot.hours,
    forecast: snapshot.forecast,
    annual: {
      calendarRevenue: a.calendarRevenue,
      manualSalaryRevenue: a.manualSalaryRevenue,
      salaryRevenue: a.salaryRevenue,
      businessRevenue: a.businessRevenue,
      businessExpenses: a.businessExpenses,
      miscRevenue: a.miscRevenue,
      miscExpenses: a.miscExpenses,
      totalRevenue: a.totalRevenue,
      salaryDeduction: a.salaryDeduction,
      salaryIncome: a.salaryIncome,
      businessIncome: a.businessIncome,
      miscIncome: a.miscIncome,
      totalIncome: a.totalIncome
    },
    recentEntries: recent,
    limits: limits,
    manualEntries: manual,
    reconcileEntries: reconcile,
    reconcileForm: getReconcileFormData(),
    categories: [INCOME_CATEGORY.SALARY, INCOME_CATEGORY.BUSINESS, INCOME_CATEGORY.MISC],
    defaultMonthlyLimit: CONFIG.hours.defaultMonthlyLimit,
    warnPercent: Math.round(CONFIG.hours.warnRatio * 100),
    alertPercent: Math.round(CONFIG.hours.alertRatio * 100),
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    disclaimer: CONFIG.disclaimer
  };
}

/* ------- 画面から呼ばれる処理（いずれも最新データを返す） ------- */

/** 再読み込み（答え合わせの再計算つき） */
function appRefresh() {
  ensureSheets_();
  autoImportRecent_();
  recalcReconciliations_();
  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return buildAppData_();
}

/** 今日の予定をいますぐ取り込む */
function appRunToday() {
  runAnalysisForDate_(new Date());
  return buildAppData_();
}

/** 指定した日を取り込み直す */
function appImportDate(dateText) {
  var date = parseDateInput_(dateText);
  if (!date) throw new Error('日付は yyyy-MM-dd の形式で入力してください');
  ensureSheets_();
  var run = importDateRange_(date, date);
  writeSummarySheet_(buildSnapshot_(new Date(), run));
  return {
    data: buildAppData_(),
    message:
      run.from + ' を取り込みました（勤務 ' + run.entries.length + '件 / 対象外 ' + run.skipped + '件 / エラー ' + run.errors.length + '件）',
    errors: run.errors
  };
}

/** 月次の答え合わせを保存 */
function appSaveReconciliation(payload) {
  var result = saveReconciliation(payload);
  return { data: buildAppData_(), result: result };
}

/** 手入力の収入を追加 */
function appAddManualIncome(payload) {
  ensureSheets_();
  var sourceName = String(payload.sourceName || '').trim();
  var period = String(payload.period || '').trim();
  if (!sourceName) throw new Error('収入元の名前を入力してください');
  if (yearOfDateString_(period) === null) {
    throw new Error('対象期間から年が読み取れません（例: 2026-03 や 2026-03〜2026-05）');
  }
  var amount = toNumber_(payload.amount);
  if (amount <= 0) throw new Error('金額を入力してください');

  appendRows_(SHEETS.MANUAL, [
    {
      id: Utilities.getUuid(),
      source_name: sourceName,
      income_category: String(payload.category || INCOME_CATEGORY.BUSINESS),
      period: period,
      amount: amount,
      expenses: toNumber_(payload.expenses),
      note: String(payload.note || ''),
      updated_at: formatDateTime_(new Date())
    }
  ]);
  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return { data: buildAppData_(), message: sourceName + ' を登録しました' };
}

/** 勤務先ごとの月間上限を更新（会社から正式な回答が来たとき） */
function appSaveCompanyLimit(payload) {
  ensureSheets_();
  var companyName = String(payload.companyName || '').trim();
  var limit = toNumber_(payload.limit);
  if (!companyName) throw new Error('勤務先を指定してください');
  if (limit <= 0) throw new Error('上限時間は1以上で入力してください');

  var table = readTable_(SHEETS.LIMITS);
  var target = null;
  table.rows.forEach(function (r) {
    if (String(r.company_name).trim() === companyName) target = r;
  });

  var row = {
    company_name: companyName,
    monthly_hour_limit: limit,
    confirmed: !!payload.confirmed,
    note: payload.confirmed ? '会社から回答済みの実数' : '暫定値。正社員の所定労働時間の回答が来たら実数に差し替える',
    updated_at: formatDateTime_(new Date())
  };
  if (target) writeRowAt_(SHEETS.LIMITS, target._rowIndex, row);
  else appendRows_(SHEETS.LIMITS, [row]);

  writeSummarySheet_(buildSnapshot_(new Date(), null));
  return {
    data: buildAppData_(),
    message: companyName + ' の月間上限を ' + limit + '時間' + (payload.confirmed ? '（確定）' : '（暫定）') + ' にしました'
  };
}

/** メニューからアプリのURLを表示する */
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('まだウェブアプリとして公開されていません。\n\nApps Script エディタの右上「デプロイ → 新しいデプロイ」→ 種類「ウェブアプリ」→\n実行するユーザー「自分」／アクセスできるユーザー「自分のみ」で公開してください。');
    return;
  }
  ui.alert('アプリのURL\n\n' + url + '\n\nスマホでこのURLを開き、ブラウザの「ホーム画面に追加」を選ぶとアプリのように使えます。');
}
