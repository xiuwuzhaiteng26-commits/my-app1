/**
 * シート書き込みまで含めた結合テスト。
 * Google のサービスをテスト用の偽実装に差し替えて node 上で動かす。
 *
 *   node apps-script/tests/run-integration-tests.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { makeSandbox, apiCalls, holidayFixture, HOLIDAY_CALENDAR_ID } from './fake-google.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const files = [
  'Config.js',
  'Assets.js',
  'Util.js',
  'Sheets.js',
  'Parser.js',
  'Calc.js',
  'Holidays.js',
  'PayCycle.js',
  'CalendarSource.js',
  'Forecast.js',
  'Summary.js',
  'Notify.js',
  'Html.js',
  'Reconcile.js',
  'SeedData.js',
  'Main.js',
  'WebApp.js'
];

const details = [];
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    details.push('OK   ' + name);
  } else {
    failed++;
    details.push(`FAIL ${name} : ${a} != ${e}`);
  }
}

const DAY = '2026-08-20';
const events = {
  [DAY]: [
    {
      id: 'evt-1@google.com',
      title: '[Kakedas] 09:00-18:00 休憩1h 時給1226円',
      start: new Date(2026, 7, 20, 9, 0),
      end: new Date(2026, 7, 20, 18, 0)
    },
    {
      id: 'evt-2@google.com',
      title: '[バイトレ] 13:00-17:00 休憩なし 時給1700円',
      start: new Date(2026, 7, 20, 13, 0),
      end: new Date(2026, 7, 20, 17, 0)
    },
    {
      id: 'evt-3@google.com',
      title: 'ゼミの発表',
      start: new Date(2026, 7, 20, 10, 0),
      end: new Date(2026, 7, 20, 12, 0)
    },
    {
      id: 'evt-4@google.com',
      title: '[時給書き忘れ] 10:00-12:00 休憩なし',
      start: new Date(2026, 7, 20, 10, 0),
      end: new Date(2026, 7, 20, 12, 0)
    }
  ]
};

// --bundle を付けると、生成された全部入り1ファイル版に対して同じテストを流す
const useBundle = process.argv.includes('--bundle');
const { sandbox, spreadsheet, sentMail, alerts, menu, dialogs } = makeSandbox(events);
const context = vm.createContext(sandbox);
if (useBundle) {
  const bundle = join(root, 'dist', 'all-in-one.gs');
  vm.runInContext(readFileSync(bundle, 'utf8'), context, { filename: 'all-in-one.gs' });
} else {
  for (const file of files) {
    vm.runInContext(readFileSync(join(root, file), 'utf8'), context, { filename: file });
  }
}
const run = (expr) => vm.runInContext(expr, context);

if (useBundle) {
  check('1ファイル版: 画面のHTMLを同梱', run('Object.keys(INLINE_HTML).sort()'), ['App', 'Reconcile']);
  check('1ファイル版: アプリ画面が読める', run("INLINE_HTML['App'].indexOf('<!DOCTYPE html>') === 0"), true);
  check('1ファイル版: セルフテストも同梱', run('typeof runTests'), 'function');
}

/* --- メニューと初期セットアップ（利用者が最初に通る道） --- */
run('onOpen()');
check('メニュー: 名前', menu.name, '年収の壁ツール');
check('メニュー: 全項目に対応する関数がある', menu.items.filter((i) => run(`typeof ${i.fn}`) !== 'function'), []);
// Apps Script はメニューやトリガーから「末尾が _ の関数」を呼べない
check('メニュー: 末尾が _ の関数を割り当てていない', menu.items.filter((i) => /_$/.test(i.fn)), []);


run('setupSheets()');
const summaryAfterSetup = spreadsheet.getSheetByName('サマリー');
check('セットアップ: サマリーに書き込まれる', summaryAfterSetup.getLastRow() > 10, true);
check('セットアップ: 免責が先頭に出る', String(summaryAfterSetup.data[0][0]).indexOf('【免責】'), 0);
check('セットアップ: 実行ログに1行残る', run('readTable_(SHEETS.LOG).rows.length'), 1);
check('セットアップ: 実行ログの見出しが全部ある', spreadsheet.getSheetByName('実行ログ').data[0], [
  '実行日時',
  '種別',
  'レベル',
  '内容'
]);
check('セットアップ: エラーダイアログは出ない', alerts.length, 0);

run('ensureSheets_()');
const sheetNames = spreadsheet.getSheets().map((s) => s.getName());
check('セットアップ: サマリーが先頭タブ', sheetNames[0], 'サマリー');
check('セットアップ: 既定の空シートを削除', sheetNames.indexOf('シート1'), -1);
check('セットアップ: 全テーブルを作成', [
  sheetNames.includes('勤務明細'),
  sheetNames.includes('手入力の収入'),
  sheetNames.includes('勤務先の上限'),
  sheetNames.includes('壁の設定'),
  sheetNames.includes('月次の答え合わせ')
], [true, true, true, true, true]);
check('セットアップ: 見出しは日本語', spreadsheet.getSheetByName('勤務明細').data[0].slice(0, 4), [
  'ID',
  '日付',
  '勤務先',
  '開始'
]);
check('セットアップ: 壁の初期値を投入', run('readTable_(SHEETS.WALLS).rows.length'), 3);
run('ensureSheets_()');
check('セットアップ: 再実行しても壁が増えない', run('readTable_(SHEETS.WALLS).rows.length'), 3);

/* --- 取り込み --- */
const target = new Date(2026, 7, 20, 23, 30);
context.__target = target;
const runInfo = run('importDateRange_(__target, __target)');
check('取り込み: 勤務予定は2件', runInfo.entries.length, 2);
check('取り込み: [ ]の無い予定は無視', runInfo.skipped, 1);
check('取り込み: 時給漏れはエラーとして報告', runInfo.errors.length, 1);

const calRows = run('readTable_(SHEETS.CALENDAR).rows');
check('明細: 行数', calRows.length, 2);
check('明細: Kakedasの実働時間', calRows[0].worked_hours, 8);
check('明細: Kakedasの推定収入', calRows[0].estimated_amount, 9808);
check('明細: バイトレの推定収入', calRows[1].estimated_amount, 6800);
check('明細: idは予定IDと日付', calRows[0].id, 'evt-1@google.com#2026-08-20');

check('勤務先: 暫定上限で自動登録', run('readTable_(SHEETS.LIMITS).rows.map(function(r){return [r.company_name, r.monthly_hour_limit, r.confirmed];})'), [
  ['Kakedas', 120, false],
  ['バイトレ', 120, false]
]);

/* --- 再取り込みで重複しないこと --- */
// 利用者がスプレッドシート上で手動でチェックを入れた状況を再現する。
// ヘルパー経由でない直接の書き込みなので、読み込みキャッシュは明示的に捨てる。
run('getSheet_(SHEETS.CALENDAR).getRange(2, 10).setValue(true); invalidateTable_(SHEETS.CALENDAR);');
run('importDateRange_(__target, __target)');
const calRows2 = run('readTable_(SHEETS.CALENDAR).rows');
check('再取り込み: 重複しない', calRows2.length, 2);
check('再取り込み: 照合済みフラグを維持', calRows2[0].reconciled, true);

/* --- 手入力の収入 --- */
run(`appendRows_(SHEETS.MANUAL, [{
  id: 'm1', source_name: '業務委託A', income_category: '事業所得',
  period: '2026-03〜2026-05', amount: 300000, expenses: 50000, note: '', updated_at: ''
}])`);

/* --- 集計とサマリー --- */
const snapshot = run('buildSnapshot_(__target, null)');
check('集計: 年間収入合計（額面）', snapshot.annual.totalRevenue, 9808 + 6800 + 300000);
check('集計: 給与所得は控除65万で0', snapshot.annual.salaryIncome, 0);
check('集計: 合計所得金額', snapshot.annual.totalIncome, 250000);
check('集計: 123万円までの残り', snapshot.walls[0].remaining, 1230000 - 316608);
check('集計: 当月の勤務先数', snapshot.hours.length, 2);
check('集計: 全体ステータス', snapshot.level, '正常');

run('writeSummarySheet_(buildSnapshot_(__target, null))');
const summaryText = spreadsheet
  .getSheetByName('サマリー')
  .data.map((line) => (line || []).join(' '))
  .join('\n');
check('サマリー: 免責を先頭に表示', summaryText.split('\n')[0].indexOf('【免責】'), 0);
check('サマリー: 壁の残りを表示', summaryText.includes('123万円') && summaryText.includes('913,392円'), true);
check('サマリー: 合計所得金額を表示', summaryText.includes('合計所得金額'), true);
check('サマリー: 労働時間を表示', summaryText.includes('Kakedas（上限は暫定値）'), true);
// 先読みが有効になったので、これからの予定の書式エラーは runInfo が無くても出る
check('サマリー: 先の予定の書式エラーも知らせる', summaryText.includes('時給の記載が見つかりません'), true);

run('writeSummarySheet_(buildSnapshot_(__target, __run))', (context.__run = runInfo));
const summaryText2 = spreadsheet
  .getSheetByName('サマリー')
  .data.map((line) => (line || []).join(' '))
  .join('\n');
check('サマリー: 解析エラーを注意メッセージに表示', summaryText2.includes('時給の記載が見つかりません'), true);
check('サマリー: 書き換えても行が残らない', summaryText2.split('\n').filter((l) => l.includes('【免責】')).length, 2);

/* --- 労働時間の警告 --- */
run(`appendRows_(SHEETS.CALENDAR, [{
  id: 'x1', date: '2026-08-05', company_name: 'Kakedas', start_time: '09:00', end_time: '18:00',
  break_hours: 0, worked_hours: 88, hourly_wage: 1226, estimated_amount: 0, reconciled: false,
  source_title: 'テスト', updated_at: ''
}])`);
const warned = run('buildSnapshot_(__target, null)');
check('警告: 96時間で注意', [warned.hours[0].hours, warned.hours[0].status], [96, '注意']);
check('警告: 全体ステータスに反映', warned.level, '注意');

/* --- 月次の答え合わせ --- */
const saved = run(`saveReconciliation({ yearMonth: '2026-08', companyName: 'バイトレ', actualAmount: 6800, note: '' })`);
check('答え合わせ: 推定額を自動計算', saved.estimated, 6800);
check('答え合わせ: 一致すればOK', saved.status, 'OK');
const savedNg = run(`saveReconciliation({ yearMonth: '2026-08', companyName: 'Kakedas', actualAmount: 20000, note: '' })`);
check('答え合わせ: ズレが大きければ要確認', savedNg.status, '要確認');
check('答え合わせ: 差分', savedNg.diff, 20000 - 9808);
check('答え合わせ: 明細に照合済みが立つ', run(`readTable_(SHEETS.CALENDAR).rows.filter(function(r){return toBool_(r.reconciled);}).length`), 3);
check('答え合わせ: 同じ月・勤務先は上書き', run('readTable_(SHEETS.RECONCILE).rows.length'), 2);

/* --- シート直接入力からの再計算 --- */
run(`appendRows_(SHEETS.RECONCILE, [{ id: '', year_month: '2026-08', company_name: '合計（全勤務先）', actual_amount: 111111 }])`);
run('recalcReconciliations_()');
const recon = run('readTable_(SHEETS.RECONCILE).rows');
check('再計算: シート直接入力も判定される', [recon[2].estimated_amount, recon[2].status], [16608, '要確認']);
check('再計算: 行が増えない（手入力行をそのまま更新）', recon.length, 3);

/* --- タイムゾーン --- */
check('タイムゾーン: 一致していれば警告なし', run('timeZoneWarning_()'), null);
run(`Session.getScriptTimeZone = function () { return 'America/Los_Angeles'; }`);
check('タイムゾーン: ずれていたら警告文を出す', run("timeZoneWarning_().indexOf('America/Los_Angeles') > 0"), true);
check(
  'タイムゾーン: 警告がサマリーの注意メッセージに載る',
  run("buildSnapshot_(__target, null).messages[0].indexOf('スクリプトのタイムゾーンが') === 0"),
  true
);
run(`Session.getScriptTimeZone = function () { return 'Asia/Tokyo'; }`);
check(
  'タイムゾーン: 直せば警告が消える',
  run("buildSnapshot_(__target, null).messages.filter(function (m) { return m.indexOf('スクリプトのタイムゾーン') === 0; }).length"),
  0
);

/* --- 通知 --- */
const notified = run('notify_(buildSnapshot_(__target, null))');
check('通知: 既定は毎日メール', [notified.channel, notified.sent], ['email', true]);
check('通知: 宛先は実行アカウント', sentMail[0].to, 'test@example.com');
check('通知: 本文に壁の残りと免責を含む', [
  sentMail[0].body.includes('123万円'),
  sentMail[0].body.includes('当月'),
  sentMail[0].body.includes('【免責】')
], [true, true, true]);
check('通知: 実行ログに記録される', run('readTable_(SHEETS.LOG).rows.length > 0'), true);

/* --- ウェブアプリ（画面） --- */
const appData = run('buildAppData_()');
check('アプリ: 壁と労働時間を返す', [appData.walls.length, appData.hours.length], [3, 2]);
check('アプリ: 直近の勤務は新しい順', appData.recentEntries[0].date, '2026-08-20');
check('アプリ: 勤務先の上限を返す', appData.limits.length, 2);
check('アプリ: 答え合わせ用の選択肢を返す', appData.reconcileForm.companies[0], '合計（全勤務先）');
check('アプリ: スプレッドシートのURLを返す', appData.spreadsheetUrl.indexOf('https://') === 0, true);
check('アプリ: 免責を返す', appData.disclaimer.indexOf('【免責】') === 0, true);

const limitSaved = run(`appSaveCompanyLimit({ companyName: 'Kakedas', limit: 90, confirmed: true })`);
const kakedas = limitSaved.data.hours.filter((h) => h.companyName === 'Kakedas')[0];
check('アプリ: 上限を実数に差し替えられる', [kakedas.limit, kakedas.confirmed], [90, true]);
check('アプリ: 上限変更が判定に反映される', kakedas.status, '警告');

let thrown = '';
try {
  run(`appAddManualIncome({ sourceName: 'X', category: '事業所得', period: '春ごろ', amount: 1000 })`);
} catch (e) {
  thrown = e.message;
}
check('アプリ: 年の無い期間は登録を拒否', thrown.indexOf('年が読み取れません') >= 0, true);

const added = run(`appAddManualIncome({ sourceName: '業務委託B', category: '雑所得', period: '2026-06', amount: 50000, expenses: 10000 })`);
check('アプリ: 手入力の収入を追加できる', added.data.annual.miscRevenue, 50000);
check('アプリ: 追加分が壁の判定に入る', added.data.annual.totalRevenue, 316608 + 50000);

thrown = '';
try {
  run(`appImportDate('2026/8/32')`);
} catch (e) {
  thrown = e.message;
}
check('アプリ: 不正な日付を拒否', thrown.indexOf('yyyy-MM-dd') >= 0, true);

const imported = run(`appImportDate('2026-08-20')`);
check('アプリ: 日付指定で取り込み直せる', imported.message.indexOf('2026-08-20 を取り込みました') === 0, true);

check('アプリ: 再読み込みで最新を返す', run('appRefresh().targetYear'), 2026);

/* --- ウェブアプリの画面が実際に返せるか --- */
{
  let error = null;
  let output = null;
  try {
    output = run('doGet()');
  } catch (e) {
    error = e.message;
  }
  check('画面: doGet が例外を出さない', error, null);
  check('画面: タイトル', output && output.getTitle(), '年収の壁');
  // Apps Script が許可していないメタタグを渡すと本番だけ落ちるので、ここで縛る
  check(
    '画面: メタタグは許可されたものだけ',
    output && output.metaTags.map((m) => m[0]),
    ['viewport', 'mobile-web-app-capable', 'apple-mobile-web-app-capable']
  );
  if (useBundle) {
    check('画面: 中身が埋め込まれている', output.getContent().indexOf('<!DOCTYPE html>') === 0, true);
    check('画面: データが差し込まれている', output.getContent().indexOf('"targetYear":2026') > 0, true);
    check('画面: 生の差し込みタグが残っていない', output.getContent().indexOf('bootstrapJson') < 0, true);
  }

  let dialogError = null;
  try {
    run('openReconcileDialog()');
  } catch (e) {
    dialogError = e.message;
  }
  check('画面: 答え合わせダイアログが開ける', dialogError, null);
  check('画面: ダイアログのタイトル', dialogs.length && dialogs[dialogs.length - 1].title, '月次の答え合わせ');
}

/* --- 毎日の実行は直近数日を見直す --- */
check('毎日の実行: 過去1ヶ月分を見直す設定', run('CONFIG.daily.lookbackDays'), 31);
{
  // 8/20 に予定を足してから 8/22 の夜間実行を回すと、後から書いた予定も拾える
  events['2026-08-20'] = [
    {
      id: 'evt-late@google.com',
      title: '[バイトレ] 10:00-15:00 休憩なし 時給1700円',
      start: new Date(2026, 7, 20, 10, 0),
      end: new Date(2026, 7, 20, 15, 0)
    }
  ];
  const before = run('readTable_(SHEETS.CALENDAR).rows.length');
  run('dailyJob()');
  const after = run('readTable_(SHEETS.CALENDAR).rows');
  check('毎日の実行: 後から書き足した過去の予定を拾う', after.length, before + 1);
  const late = after.filter((r) => String(r.id).indexOf('evt-late') === 0)[0];
  check('毎日の実行: 拾った内容', [late.date, late.company_name, late.worked_hours, late.estimated_amount], ['2026-08-20', 'バイトレ', 5, 8500]);
  run('dailyJob()');
  check('毎日の実行: 繰り返しても二重計上しない', run('readTable_(SHEETS.CALENDAR).rows.length'), before + 1);
  delete events['2026-08-20'];
}

/* --- アプリを開いたときの自動取り込み --- */
{
  // autoImportRecent_ は実行時点の「今日」を見るので、テストも実行日で組み立てる
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth();
  const day = now.getDate();
  const key = (offset) => {
    const d = new Date(y, mo, day - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const at = (offset, hour) => new Date(y, mo, day - offset, hour, 0);

  const autoEnv = makeSandbox({
    [key(0)]: [{ id: 'auto-today', title: '[会社Z] 10:00-15:00 休憩なし 時給1500円', start: at(0, 10), end: at(0, 15) }],
    [key(2)]: [{ id: 'auto-2days', title: '[会社Z] 09:00-18:00 休憩1h 時給1500円', start: at(2, 9), end: at(2, 18) }],
    [key(9)]: [{ id: 'auto-9days', title: '[会社Z] 09:00-18:00 休憩1h 時給1500円', start: at(9, 9), end: at(9, 18) }],
    [key(40)]: [{ id: 'auto-old', title: '[会社Z] 09:00-18:00 休憩1h 時給1500円', start: at(40, 9), end: at(40, 18) }]
  });
  const aCtx = vm.createContext(autoEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), aCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), aCtx, { filename: file });
  }
  const aRun = (expr) => vm.runInContext(expr, aCtx);
  aRun('ensureSheets_()');

  check('自動取り込み: 開く前は空', aRun('readTable_(SHEETS.CALENDAR).rows.length'), 0);

  // 画面表示（doGet）ではカレンダーに触らない＝待たされない
  aRun('doGet()');
  check('自動取り込み: 画面表示ではまだ取り込まない', aRun('readTable_(SHEETS.CALENDAR).rows.length'), 0);

  // 表示後の同期で取り込む
  aRun('appSyncCalendar()');
  const imported = aRun('readTable_(SHEETS.CALENDAR).rows');
  check('自動取り込み: アプリを開くと直近1ヶ月分が入る', imported.length, 3);
  check(
    '自動取り込み: 今日の分の内容',
    imported.filter((r) => String(r.id).indexOf('auto-today') === 0).map((r) => [r.worked_hours, r.estimated_amount]),
    [[5, 7500]]
  );
  check('自動取り込み: 1ヶ月より前は取り込まない', imported.filter((r) => String(r.id).indexOf('auto-old') === 0).length, 0);

  // 2回目以降は、内容が変わっていないので書き込みが発生しないこと
  const calendarSheet = autoEnv.spreadsheet.getSheetByName('勤務明細');
  calendarSheet.writes = 0;
  aRun('appSyncCalendar()');
  check('自動取り込み: 変わっていなければ書き込まない', calendarSheet.writes, 0);
  aRun('appRefresh()');
  check('自動取り込み: 何度開いても二重にならない', aRun('readTable_(SHEETS.CALENDAR).rows.length'), 3);

  // 予定を直したら、その行だけ書き直されること
  autoEnv.spreadsheet.getSheetByName('勤務明細').writes = 0;
  aRun("__events = null");
  autoEnv.sandbox.CalendarApp.getDefaultCalendar = (function (original) {
    return function () {
      const calendar = original();
      return {
        getEventsForDay: calendar.getEventsForDay,
        getEvents: (start, end) =>
          calendar.getEvents(start, end).map((e) => {
            if (e.getId() === 'auto-today') e.title = '[会社Z] 10:00-16:00 休憩なし 時給1500円';
            return e;
          })
      };
    };
  })(autoEnv.sandbox.CalendarApp.getDefaultCalendar);
  aRun('appSyncCalendar()');
  const changed = aRun('readTable_(SHEETS.CALENDAR).rows').filter((r) => String(r.id).indexOf('auto-today') === 0)[0];
  check('自動取り込み: 予定を直すと反映される', [changed.worked_hours, changed.estimated_amount], [6, 9000]);
  check('自動取り込み: 直した1行だけ書き込む', calendarSheet.writes, 1);

  // 期間指定の取り込みは1回のAPI呼び出しでも日をまたいで拾えること
  aRun('__from = new Date(' + y + ', ' + mo + ', ' + (day - 45) + ')');
  aRun('__to = new Date(' + y + ', ' + mo + ', ' + day + ')');
  const ranged = aRun('importDateRange_(__from, __to)');
  check('期間取り込み: 45日前の分まで拾う', ranged.entries.length, 4);
  check('期間取り込み: 期間の表示', [ranged.days, ranged.from === key(45), ranged.to === key(0)], [46, true, true]);
  check('期間取り込み: それでも重複しない', aRun('readTable_(SHEETS.CALENDAR).rows.length'), 4);
}

/* --- 手当（カレンダーに書いた固定額が収入に入るか） --- */
{
  const allowEnv = makeSandbox({
    '2026-08-10': [
      {
        id: 'evt-allow',
        title: '[バイトレ] 09:00-17:00 休憩なし 時給1700円 交通費800円',
        start: new Date(2026, 7, 10, 9, 0),
        end: new Date(2026, 7, 10, 17, 0)
      },
      {
        id: 'evt-plain',
        title: '[Kakedas] 09:00-18:00 休憩1h 時給1226円',
        start: new Date(2026, 7, 10, 9, 0),
        end: new Date(2026, 7, 10, 18, 0)
      }
    ]
  });
  const alCtx = vm.createContext(allowEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), alCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), alCtx, { filename: file });
  }
  const alRun = (expr) => vm.runInContext(expr, alCtx);
  alRun('ensureSheets_()');
  alRun('importDateRange_(new Date(2026, 7, 10), new Date(2026, 7, 10))');

  const rows = alRun('readTable_(SHEETS.CALENDAR).rows');
  const allow = rows.filter((r) => r.company_name === 'バイトレ')[0];
  const plain = rows.filter((r) => r.company_name === 'Kakedas')[0];

  check('手当: 明細に手当が保存される', Number(allow.allowance), 800);
  check('手当: 推定収入に手当が乗る', Number(allow.estimated_amount), 8 * 1700 + 800);
  check('手当: 手当が無い勤務は従来どおり', [Number(plain.allowance), Number(plain.estimated_amount)], [0, 9808]);

  const snap = alRun('buildSnapshot_(new Date(2026, 7, 10, 23, 30), null)');
  check('手当: 年間収入に含まれる', snap.annual.totalRevenue, 8 * 1700 + 800 + 9808);
  check('手当: 手当の合計を別に持つ', snap.annual.allowanceTotal, 800);

  const app = alRun('buildAppData_()');
  check(
    '手当: アプリの明細に手当が出る',
    app.recentEntries.filter((e) => e.companyName === 'バイトレ')[0].allowance,
    800
  );
  check('手当: アプリの年間集計に手当の合計が入る', app.annual.allowanceTotal, 800);

  // 手当を書き換えたら反映されること
  allowEnv.sandbox.CalendarApp.getDefaultCalendar = (function (original) {
    return function () {
      const calendar = original();
      return {
        getEventsForDay: calendar.getEventsForDay,
        getEvents: (start, end) =>
          calendar.getEvents(start, end).map((e) => {
            if (e.getId() === 'evt-allow') e.title = '[バイトレ] 09:00-17:00 休憩なし 時給1700円 交通費1200円';
            return e;
          })
      };
    };
  })(allowEnv.sandbox.CalendarApp.getDefaultCalendar);
  alRun('beginExecution_(); importDateRange_(new Date(2026, 7, 10), new Date(2026, 7, 10))');
  const updated = alRun('readTable_(SHEETS.CALENDAR).rows').filter((r) => r.company_name === 'バイトレ')[0];
  check('手当: 書き換えると反映される', [Number(updated.allowance), Number(updated.estimated_amount)], [1200, 8 * 1700 + 1200]);
  check('手当: 書き換えても重複しない', alRun('readTable_(SHEETS.CALENDAR).rows.length'), 2);
}

/* --- 支給額（残業などでその日の金額が変わったとき） --- */
{
  let title = '[バイトレ] 09:00-17:00 休憩なし 時給1700円';
  const fxEnv = makeSandbox({
    '2026-08-12': [
      { id: 'evt-fx', title, start: new Date(2026, 7, 12, 9, 0), end: new Date(2026, 7, 12, 17, 0) }
    ]
  });
  // タイトルを後から書き換えられるようにする（カレンダーを直したのと同じ状況）
  fxEnv.sandbox.CalendarApp.getDefaultCalendar = (function (original) {
    return function () {
      const calendar = original();
      return {
        getEventsForDay: calendar.getEventsForDay,
        getEvents: (start, end) =>
          calendar.getEvents(start, end).map((e) => {
            if (e.getId() === 'evt-fx') e.title = title;
            return e;
          })
      };
    };
  })(fxEnv.sandbox.CalendarApp.getDefaultCalendar);

  const fxCtx = vm.createContext(fxEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), fxCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), fxCtx, { filename: file });
  }
  const fxRun = (expr) => vm.runInContext(expr, fxCtx);
  const reimport = () => fxRun('beginExecution_(); importDateRange_(new Date(2026, 7, 12), new Date(2026, 7, 12))');
  const only = () => fxRun('readTable_(SHEETS.CALENDAR).rows')[0];

  fxRun('ensureSheets_()');
  reimport();
  check('支給額: 最初は時給×時間', [Number(only().estimated_amount), Number(only().fixed_amount)], [8 * 1700, 0]);

  // あとから交通費だけを書き足す
  title = '[バイトレ] 09:00-17:00 休憩なし 時給1700円 交通費800円';
  reimport();
  check('あとから追記: 交通費が反映される', Number(only().estimated_amount), 8 * 1700 + 800);
  check('あとから追記: 行は増えない', fxRun('readTable_(SHEETS.CALENDAR).rows.length'), 1);

  // 残業がついて支給額が変わった日
  title = '[バイトレ] 09:00-19:00 休憩なし 時給1700円 支給18500円';
  reimport();
  check('支給額: 書いた金額がそのまま入る', Number(only().estimated_amount), 18500);
  check('支給額: 明細にも支給額として残る', Number(only().fixed_amount), 18500);
  check('支給額: 実働時間は時刻どおり', Number(only().worked_hours), 10);
  check('支給額: 年間収入に反映される', fxRun('buildSnapshot_(new Date(2026, 7, 12, 23, 30), null)').annual.totalRevenue, 18500);
  check('支給額: アプリの明細に出る', fxRun('buildAppData_()').recentEntries[0].fixedAmount, 18500);

  // 照合済みの印は、書き換えても消えない
  fxRun("markReconciled_('2026-08', RECONCILE_ALL)");
  title = '[バイトレ] 09:00-19:00 休憩なし 時給1700円 支給19000円';
  reimport();
  check(
    '支給額: 書き換えても照合済みは消えない',
    [Number(only().estimated_amount), fxRun('toBool_(readTable_(SHEETS.CALENDAR).rows[0].reconciled)')],
    [19000, true]
  );

  // 支給額を消したら計算に戻る
  title = '[バイトレ] 09:00-19:00 休憩なし 時給1700円';
  reimport();
  check('支給額: 消せば時給×時間に戻る', [Number(only().estimated_amount), Number(only().fixed_amount)], [10 * 1700, 0]);
}

/* --- 複数アカウントのカレンダーをまとめて取り込む --- */
{
  const DAY = '2026-08-20';
  const primaryEvents = {
    [DAY]: [
      {
        id: 'evt-primary',
        title: '[Kakedas] 09:00-18:00 休憩1h 時給1226円',
        start: new Date(2026, 7, 20, 9, 0),
        end: new Date(2026, 7, 20, 18, 0)
      }
    ]
  };
  const otherEvents = {
    'sub-account@example.com': {
      [DAY]: [
        {
          id: 'evt-primary', // 別カレンダーの偶然の同名IDでも衝突しないことを見る
          title: '[バイトレ] 13:00-17:00 休憩なし 時給1700円',
          start: new Date(2026, 7, 20, 13, 0),
          end: new Date(2026, 7, 20, 17, 0)
        }
      ]
    }
  };
  const multiEnv = makeSandbox(primaryEvents, otherEvents);
  const multiCtx = vm.createContext(multiEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), multiCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), multiCtx, { filename: file });
  }
  const mRun = (expr) => vm.runInContext(expr, multiCtx);
  mRun('ensureSheets_()');

  // 共有していない/設定していない状態では primary の予定だけが入る
  const before = mRun(`importDateRange_(new Date(2026, 7, 20), new Date(2026, 7, 20))`);
  check('複数カレンダー: 未設定なら既定カレンダーのみ', before.entries.length, 1);
  check('複数カレンダー: 既定カレンダーの予定', before.entries[0].company_name, 'Kakedas');

  // CONFIG.calendarIds に共有カレンダーを追加すると、両方の予定が入る
  mRun(`invalidateCalendarCache_(); CONFIG.calendarIds = ['primary', 'sub-account@example.com']`);
  mRun('getSheet_(SHEETS.CALENDAR).clear(); invalidateSheetCaches_(); ensureSheets_({ force: true })');
  const both = mRun(`importDateRange_(new Date(2026, 7, 20), new Date(2026, 7, 20))`);
  check('複数カレンダー: 両方のカレンダーから取り込む', both.entries.length, 2);
  check(
    '複数カレンダー: 会社名がどちらも入る',
    both.entries.map((e) => e.company_name).sort(),
    ['Kakedas', 'バイトレ']
  );
  check(
    '複数カレンダー: 同名イベントIDでも行IDが衝突しない',
    mRun('readTable_(SHEETS.CALENDAR).rows.map(function(r){return r.id;})'),
    ['evt-primary#2026-08-20', 'sub-account@example.com:evt-primary#2026-08-20']
  );
  check(
    '複数カレンダー: 金額もそれぞれ正しく計算される',
    mRun('readTable_(SHEETS.CALENDAR).rows.map(function(r){return r.estimated_amount;})').sort((a, b) => a - b),
    [6800, 9808]
  );

  // 共有されていない/存在しないカレンダーIDを指定した場合、エラーを添えつつ他は取り込む
  mRun(`invalidateCalendarCache_(); CONFIG.calendarIds = ['primary', 'not-shared@example.com']`);
  mRun('getSheet_(SHEETS.CALENDAR).clear(); invalidateSheetCaches_(); ensureSheets_({ force: true })');
  const partial = mRun(`importDateRange_(new Date(2026, 7, 20), new Date(2026, 7, 20))`);
  check('複数カレンダー: 読めないカレンダーがあっても他は取り込める', partial.entries.length, 1);
  check('複数カレンダー: 読めないカレンダーはエラーとして報告', partial.errors.length > 0, true);
  check('複数カレンダー: エラーにカレンダーIDを含める', partial.errors[0].indexOf('not-shared@example.com') >= 0, true);

  // 先読み（見込み）も同じ仕組みで複数カレンダーを見る
  mRun(`invalidateCalendarCache_(); CONFIG.calendarIds = ['primary', 'sub-account@example.com']`);
  const planned = mRun(`fetchPlannedShifts_(new Date(2026, 7, 20), new Date(2026, 7, 21))`);
  check('複数カレンダー: 見込みの先読みも複数カレンダーを見る', planned.entries.length, 2);
}

/* --- この先の見込みと調整アドバイス --- */
{
  const shift = (date, h, m, hours, company, wage) => ({
    id: `plan-${date}-${h}`,
    title: `[${company}] ${String(h).padStart(2, '0')}:00-${String(h + hours).padStart(2, '0')}:00 休憩なし 時給${wage}円`,
    start: new Date(2026, m - 1, date, h, 0),
    end: new Date(2026, m - 1, date, h + hours, 0)
  });
  const fEnv = makeSandbox({
    '2026-08-25': [shift(25, 9, 8, 8, '会社A', 1200)],
    '2026-08-26': [shift(26, 9, 8, 8, '会社A', 1200)],
    '2026-08-27': [shift(27, 9, 8, 8, '会社A', 1200)],
    '2026-08-28': [shift(28, 9, 8, 4, '会社A', 1200)],
    '2026-09-02': [shift(2, 9, 9, 8, '会社A', 1200)]
  });
  const fCtx = vm.createContext(fEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), fCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), fCtx, { filename: file });
  }
  const fRun = (expr) => vm.runInContext(expr, fCtx);
  fRun('ensureSheets_()');
  // 8月にすでに100時間の実績がある状態を作る
  fRun(`appendRows_(SHEETS.CALENDAR, [{
    id: 'past-1', date: '2026-08-01', company_name: '会社A', start_time: '09:00', end_time: '19:00',
    break_hours: 0, worked_hours: 100, hourly_wage: 1200, estimated_amount: 120000,
    reconciled: false, source_title: '', updated_at: ''
  }])`);
  fRun('__now = new Date(2026, 7, 22, 23, 30)');
  const snap = fRun('buildSnapshot_(__now, null)');
  const f = snap.forecast;

  check('見込み: 先読みできる', f.available, true);
  check('見込み: 期間', [f.from, f.to], ['2026-08-22', '2026-09-25']);
  check('見込み: 予定の件数と時間', [f.plannedCount, f.plannedHours], [5, 36]);
  check('見込み: 予定分の収入', f.plannedRevenue, 36 * 1200);

  const aug = f.months.filter((m) => m.yearMonth === '2026-08')[0];
  check('見込み: 8月は実績100h＋予定28h', [aug.actualHours, aug.plannedHours, aug.projectedHours], [100, 28, 128]);
  check('見込み: 上限120hを超えるので警告', [aug.status, aug.overHours], ['警告', 8]);
  const sep = f.months.filter((m) => m.yearMonth === '2026-09')[0];
  check('見込み: 翌月も見る', [sep.yearMonth, sep.projectedHours, sep.status], ['2026-09', 8, '正常']);

  const cutAdvice = f.advice.filter((a) => a.text.indexOf('上限') > 0 && a.level === '警告')[0];
  check('見込み: 超過分と外すシフトを具体的に出す', [
    cutAdvice.text.indexOf('8時間超えます') > 0,
    cutAdvice.text.indexOf('8/25(火) 8時間') > 0,
    cutAdvice.text.indexOf('120時間になり収まります') > 0
  ], [true, true, true]);

  const roomAdvice = f.advice.filter((a) => a.text.indexOf('余裕があります') > 0)[0];
  check('見込み: 壁までの余裕を時間と日数で示す', [
    roomAdvice.level,
    roomAdvice.text.indexOf('123万円まで') > 0,
    /あと\d+時間（8時間勤務で約\d+日）働けます/.test(roomAdvice.text)
  ], ['情報', true, true]);

  check('見込み: 全体ステータスに反映される', snap.level, '警告');
  check('見込み: 先読みは勤務明細に書き込まない', fRun('readTable_(SHEETS.CALENDAR).rows.length'), 1);

  // 実績として取り込み済みの勤務は予定から除く（二重計上しない）
  fRun('__d = new Date(2026, 7, 25, 12, 0)');
  fRun('importDateRange_(__d, __d)');
  const after = fRun('buildSnapshot_(__now, null)').forecast;
  check('見込み: 取り込み済みの分は予定から外れる', [after.plannedCount, after.plannedHours], [4, 28]);
  const aug2 = after.months.filter((m) => m.yearMonth === '2026-08')[0];
  check('見込み: 実績に移っても合計は変わらない', aug2.projectedHours, 128);

  // 壁を超える見込みのとき
  fRun(`appendRows_(SHEETS.MANUAL, [{
    id: 'big', source_name: 'テスト', income_category: '給与所得', period: '2026-01',
    amount: 1250000, expenses: 0, note: '', updated_at: ''
  }])`);
  const over = fRun('buildSnapshot_(__now, null)').forecast;
  const overAdvice = over.advice.filter((a) => a.text.indexOf('壁を') > 0 && a.level === '警告')[0];
  check('見込み: 壁超過を金額と時間で警告', [
    overAdvice.text.indexOf('123万円の壁を') > 0,
    /\d+時間分（8時間勤務で約\d+日分）減らす必要があります/.test(overAdvice.text)
  ], [true, true]);

  // 予定が無い場合
  const emptyEnv = makeSandbox({});
  const eCtx = vm.createContext(emptyEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), eCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), eCtx, { filename: file });
  }
  vm.runInContext('ensureSheets_()', eCtx);
  const emptyForecast = vm.runInContext('buildSnapshot_(new Date(2026, 7, 22), null)', eCtx).forecast;
  check('見込み: 予定が無ければその旨を伝える', emptyForecast.advice.filter((a) => a.text.indexOf('勤務予定は入っていません') > 0).length, 1);
}

/* --- 一括取り込み（SeedData）の仕組み --- */
{
  // 個人情報を公開リポジトリに置かないため、テストは架空のデータで行う
  const seedEnv = makeSandbox({
    '2026-08-05': [
      {
        id: 'evt-cal@google.com',
        title: '[会社A] 09:00-18:00 休憩1h 時給1200円',
        start: new Date(2026, 7, 5, 9, 0),
        end: new Date(2026, 7, 5, 18, 0)
      }
    ]
  });
  const seedContext = vm.createContext(seedEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), seedContext, {
      filename: 'all-in-one.gs'
    });
  } else {
    for (const file of files) {
      vm.runInContext(readFileSync(join(root, file), 'utf8'), seedContext, { filename: file });
    }
  }
  const seedRun = (expr) => vm.runInContext(expr, seedContext);

  check('一括取り込み: 未入力なら何もしない', seedRun('importSeedData()'), null);
  check('一括取り込み: 未入力の案内を出す', seedEnv.alerts.length, 1);

  seedRun(`SEED_MANUAL_INCOME = [
    { source_name: '委託先X', income_category: '事業所得', period: '2026-03〜2026-05', amount: 300000, expenses: 20000, note: 'テスト' },
    { source_name: '勤務先Y', income_category: '給与所得', period: '2026〜2026-07', amount: 100000, expenses: 0, note: 'テスト' }
  ]`);
  seedRun(`SEED_SHIFTS = [
    ['2026-07-01', '会社A', '09:00', '18:00', 1, 1200],
    ['2026-07-06', '会社A', '09:00', '12:00', 0, 1200],
    ['2026-07-24', '会社A', '12:00', '18:00', 0, 1200],
    ['2026-08-05', '会社A', '09:00', '18:00', 1, 1200],
    ['2026-08-22', '会社B', '09:00', '17:00', 0, 1500]
  ]`);
  seedRun('importSeedData()');

  const rows = seedRun('readTable_(SHEETS.CALENDAR).rows');
  check('一括取り込み: シフト件数', rows.length, 5);
  const hours = (c) => rows.filter((r) => r.company_name === c).reduce((sum, r) => sum + Number(r.worked_hours), 0);
  const amount = (c) => rows.filter((r) => r.company_name === c).reduce((sum, r) => sum + Number(r.estimated_amount), 0);
  check('一括取り込み: 実働時間（8+3+6+8）', hours('会社A'), 25);
  check('一括取り込み: 推定収入（25h×1200円）', amount('会社A'), 30000);
  check('一括取り込み: 休憩なしの8時間勤務', [hours('会社B'), amount('会社B')], [8, 12000]);
  check('一括取り込み: 勤務先が自動登録される', seedRun('readTable_(SHEETS.LIMITS).rows.length'), 2);

  const annual = seedRun('buildSnapshot_(new Date(2026, 7, 22, 23, 30), null)').annual;
  check('一括取り込み: 給与収入（手入力＋シフト）', annual.salaryRevenue, 100000 + 42000);
  check('一括取り込み: 事業収入', annual.businessRevenue, 300000);
  check('一括取り込み: 年間収入合計', annual.totalRevenue, 442000);
  check('一括取り込み: 事業所得は経費を引く', annual.businessIncome, 280000);
  check('一括取り込み: 合計所得金額', annual.totalIncome, 280000);
  check('一括取り込み: 123万円まで残り', seedRun('buildSnapshot_(new Date(2026, 7, 22, 23, 30), null)').walls[0].remaining, 1230000 - 442000);

  // 二重計上しないこと
  seedRun('importSeedData()');
  check('一括取り込み: 再実行しても増えない', seedRun('readTable_(SHEETS.CALENDAR).rows.length'), 5);
  check('一括取り込み: 手入力も増えない', seedRun('readTable_(SHEETS.MANUAL).rows.length'), 2);

  // 同じ勤務をカレンダーから取り込んでも二重にならない
  seedRun('__day = new Date(2026, 7, 5, 12, 0)');
  seedRun('importDateRange_(__day, __day)');
  const afterImport = seedRun('readTable_(SHEETS.CALENDAR).rows');
  check('一括取り込み: カレンダー取り込みでも二重にならない', afterImport.length, 5);
  check(
    '一括取り込み: カレンダー側の行に置き換わる',
    afterImport.filter((r) => r.date === '2026-08-05').map((r) => String(r.id)),
    ['evt-cal@google.com#2026-08-05']
  );
  check('一括取り込み: 置き換わっても合計は同じ', afterImport.reduce((sum, r) => sum + Number(r.estimated_amount), 0), 42000);
  seedRun('importSeedData()');
  check('一括取り込み: 取り込み済みの勤務は上書きしない', seedRun('readTable_(SHEETS.CALENDAR).rows.length'), 5);
}

/* --- 給与サイクル（締め日と支給日で年収を数える） --- */
{
  const pcEnv = makeSandbox(
    {
      // 3/21〜4/20 の締め期間。支給は 5/10(日) → 前倒しで 5/8(金)
      '2026-03-21': [
        {
          id: 'pc-1',
          title: '[リージェンシー社] 09:00-18:00 休憩1h 時給1200円',
          start: new Date(2026, 2, 21, 9, 0),
          end: new Date(2026, 2, 21, 18, 0)
        }
      ],
      // 12月の勤務。支給は翌年 → 2026年の壁には入らない
      '2026-12-05': [
        {
          id: 'pc-2',
          title: '[リージェンシー社] 09:00-18:00 休憩1h 時給1200円',
          start: new Date(2026, 11, 5, 9, 0),
          end: new Date(2026, 11, 5, 18, 0)
        }
      ]
    },
    { [HOLIDAY_CALENDAR_ID]: holidayFixture([2025, 2026, 2027]) }
  );
  const pcCtx = vm.createContext(pcEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), pcCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), pcCtx, { filename: file });
  }
  const pcRun = (expr) => vm.runInContext(expr, pcCtx);

  pcRun('ensureSheets_()');
  pcRun(`SEED_PAY_CYCLES = [{
    company_name: 'リージェンシー社', cutoff_day: 20, pay_month_offset: 1, pay_day: 10,
    shift_rule: '前倒し', shift_on_holiday: true, confirmed: true, note: '実例'
  }];
  seedPayCycles_();`);
  pcRun('importDateRange_(new Date(2026, 2, 21), new Date(2026, 11, 5))');

  const rows = pcRun('readTable_(SHEETS.CALENDAR).rows');
  const march = rows.filter((r) => String(r.date) === '2026-03-21')[0];
  const december = rows.filter((r) => String(r.date) === '2026-12-05')[0];
  check('給与サイクル: 明細に支給日が入る', String(march.paid_on), '2026-05-08');
  check('給与サイクル: 12月の勤務は翌年払い', String(december.paid_on), '2027-01-08');

  const snap2026 = pcRun('buildSnapshot_(new Date(2026, 11, 31, 23, 30), null)');
  check('給与サイクル: 支給日ベースで集計している', snap2026.annual.byPayDate, true);
  check('給与サイクル: 12月分は2026年の収入に入れない', snap2026.annual.calendarRevenue, 9600);
  check('給与サイクル: 翌年に回った分が分かる', snap2026.annual.carriedOutRevenue, 9600);

  const payments = snap2026.payments;
  check('振込予定: 2026年の支給は1回', payments.length, 1);
  check(
    '振込予定: 支給日・締め期間・金額',
    [payments[0].payDate, payments[0].periodFrom, payments[0].periodTo, payments[0].amount],
    ['2026-05-08', '2026-03-21', '2026-04-20', 9600]
  );
  check('振込予定: 休日で前倒しになったことが分かる', [payments[0].moved, payments[0].scheduledDate], [true, '2026-05-10']);
  check('アプリ: 振込予定を画面に渡す', pcRun('buildAppData_({ skipForecast: true })').payments.length, 1);

  // 新しい勤務先は暫定のサイクルが自動で登録される
  check(
    '給与サイクル: 未登録の勤務先も行ができる',
    pcRun("readTable_(SHEETS.PAYCYCLE).rows.length >= 1"),
    true
  );
}

/* --- 祝日（支給日の前倒し判定） --- */
{
  const hEnv = makeSandbox({}, { [HOLIDAY_CALENDAR_ID]: holidayFixture([2025, 2026, 2027]) });
  const hCtx = vm.createContext(hEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), hCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), hCtx, { filename: file });
  }
  const hRun = (expr) => vm.runInContext(expr, hCtx);
  hRun('ensureSheets_()');

  check('祝日: 取り込む前は空', hRun('readStoredHolidays_().available'), false);
  apiCalls.reset();
  hRun('refreshHolidays_(new Date(2026, 7, 30))');
  check('祝日: 取り込みでカレンダーを1回読む', apiCalls.calendarFetch, 1);
  check('祝日: 文化の日が入っている', hRun("holidayMap_()['2026-11-03']"), '文化の日');

  // 2回目は取り込み直さない（起動を遅くしないため）
  apiCalls.reset();
  hRun('invalidateHolidayCache_(); refreshHolidays_(new Date(2026, 7, 30))');
  check('祝日: 期限内なら読み直さない', apiCalls.calendarFetch, 0);

  // 11/23（月・勤労感謝の日）払いの会社は、直前の平日 11/20（金）に前倒しされる
  hRun(`SEED_PAY_CYCLES = [{
    company_name: '祝日社', cutoff_day: 31, pay_month_offset: 0, pay_day: 23,
    shift_rule: '前倒し', shift_on_holiday: true, confirmed: true
  }];
  seedPayCycles_();`);
  const resolved = hRun("makePaymentResolver_(holidayMap_())('祝日社', '2026-11-05')");
  check('祝日: 平日の祝日は直前の平日に前倒し', [resolved.scheduledDate, resolved.payDate], ['2026-11-23', '2026-11-20']);

  // 画面表示（doGet）は祝日の取り込みでカレンダーに触らない
  apiCalls.reset();
  hRun('beginExecution_(); doGet()');
  check('祝日: 画面表示ではカレンダーを読まない', apiCalls.calendarFetch, 0);
}

/* --- 画面（ダイアログ）を出せない場所から実行されたとき --- */
{
  // Apps Script エディタの「実行」ボタンや時間主導トリガーからは
  // SpreadsheetApp.getUi() が使えない。英文の例外ではなく案内を出すこと。
  const uiEnv = makeSandbox({});
  uiEnv.sandbox.SpreadsheetApp.getUi = () => {
    throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
  };
  const uiCtx = vm.createContext(uiEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), uiCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), uiCtx, { filename: file });
  }
  const uiRun = (expr) => vm.runInContext(expr, uiCtx);

  check('画面なし: Ui が使えないと分かる', uiRun('getUiOrNull_() === null'), true);

  let message = '';
  try {
    uiRun('openReconcileDialog()');
  } catch (e) {
    message = e.message;
  }
  check('画面なし: 日本語で案内する', message.indexOf('スプレッドシートのメニュー') >= 0, true);
  check('画面なし: どのメニュー項目かを示す', message.indexOf('月次の答え合わせを入力') >= 0, true);
  check('画面なし: 英文の例外をそのまま出さない', message.indexOf('Cannot call') >= 0, false);

  check('画面なし: メニューを作ろうとしても落ちない', uiRun('onOpen(); true'), true);
  check('画面なし: 初期セットアップは最後まで通る', uiRun('setupSheets(); true'), true);
  check('画面なし: 取り込みも通る', uiRun('runAnalysisForDate_(new Date(2026, 7, 20)); true'), true);
}

/* --- アプリの表示速度（Google API の往復回数） --- */
{
  // Apps Script はシート・カレンダーへの往復1回ごとに待ち時間が発生し、
  // それが体感速度をほぼ決める。全シートにデータが入った現実的な状態で、
  // アプリを開いたときの往復回数が増えていないことを見張る。
  const now = new Date();
  const perfEvents = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15 + i);
    if (i % 2 !== 0) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    perfEvents[key] = [
      {
        id: `perf-${i}`,
        title: '[会社P] 09:00-18:00 休憩1h 時給1200円',
        start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0),
        end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0)
      }
    ];
  }

  const perfEnv = makeSandbox(perfEvents);
  const perfCtx = vm.createContext(perfEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), perfCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), perfCtx, { filename: file });
  }
  const perfRun = (expr) => vm.runInContext(expr, perfCtx);

  perfRun('setupSheets()');
  // 全シートにデータがある状態にする
  perfRun(`appendRows_(SHEETS.MANUAL, [{
    id: 'p1', source_name: 'テスト', income_category: '給与所得', period: '2026-03',
    amount: 100000, expenses: 0, note: '', updated_at: ''
  }])`);
  perfRun(`appendRows_(SHEETS.RECONCILE, [{
    id: 'r1', year_month: '2026-07', company_name: '会社P', actual_amount: 100000,
    estimated_amount: 100000, diff: 0, diff_rate: '0%', status: 'OK', note: '', entered_at: ''
  }])`);
  perfRun('appSyncCalendar()'); // 1回目で取り込みを済ませる

  // 画面が出るまで（doGet）にかかる往復。ここが体感速度を決める。
  apiCalls.reset();
  perfRun('doGet()');
  check('表示速度: 画面表示でカレンダーを待たない', apiCalls.calendarFetch, 0);
  check('表示速度: 画面表示では書き込まない', apiCalls.sheetWrite, 0);
  check('表示速度: 画面表示の往復は7回以下', apiCalls.total <= 7, true);

  // 表示後の同期
  apiCalls.reset();
  perfRun('appSyncCalendar()');
  check('同期: カレンダーの取得は1回だけ', apiCalls.calendarFetch, 1);
  check('同期: 変更が無ければシートに書き込まない', apiCalls.sheetWrite, 0);
  check('同期: 往復の合計は9回以下', apiCalls.total <= 9, true);

  // 同じ表を何度読んでも往復は1回だけであること
  apiCalls.reset();
  perfRun('beginExecution_(); readTable_(SHEETS.CALENDAR); readTable_(SHEETS.CALENDAR); readTable_(SHEETS.CALENDAR);');
  check('表示速度: 同じ表の読み直しは往復しない', apiCalls.sheetRead, 1);

  // 書き込んだら必ず読み直すこと（古いまま返さない）
  perfRun(`appendRows_(SHEETS.MANUAL, [{
    id: 'p2', source_name: '追加分', income_category: '給与所得', period: '2026-04',
    amount: 50000, expenses: 0, note: '', updated_at: ''
  }])`);
  check(
    '表示速度: 書き込み後は最新を返す',
    perfRun('readTable_(SHEETS.MANUAL).rows.length'),
    2
  );
}

/* --- 英語シート名からの移行 --- */
{
  const legacy = makeSandbox({});
  const legacyContext = vm.createContext(legacy.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), legacyContext, {
      filename: 'all-in-one.gs'
    });
  } else {
    for (const file of files) {
      vm.runInContext(readFileSync(join(root, file), 'utf8'), legacyContext, { filename: file });
    }
  }
  // 旧バージョンで作られた状態を再現する（英語のシート名・英語の見出し・データ入り）
  const old = legacy.spreadsheet.insertSheet('calendar_income_entries');
  old.data = [
    ['id', 'date', 'company_name', 'start_time', 'end_time', 'break_hours', 'worked_hours', 'hourly_wage', 'estimated_amount', 'reconciled', 'source_title', 'updated_at'],
    ['evt-9#2026-08-01', '2026-08-01', 'Kakedas', '09:00', '18:00', 1, 8, 1226, 9808, true, '[Kakedas] …', '']
  ];
  legacy.spreadsheet.insertSheet('wall_thresholds').data = [
    ['name', 'amount', 'applicable_year', 'last_updated', 'note'],
    ['123万円', 1230000, 2026, '2026-08-22', '所得税・扶養控除に関する壁の目安（自分で書き換えたメモ）']
  ];
  vm.runInContext('ensureSheets_()', legacyContext);

  const names = legacy.spreadsheet.getSheets().map((x) => x.getName());
  check('移行: 英語シート名を日本語に付け替える', names.includes('勤務明細') && !names.includes('calendar_income_entries'), true);
  check('移行: 見出しを日本語に貼り替える', legacy.spreadsheet.getSheetByName('勤務明細').data[0].slice(0, 3), ['ID', '日付', '勤務先']);
  const kept = vm.runInContext('readTable_(SHEETS.CALENDAR).rows', legacyContext);
  check('移行: データはそのまま残る', [kept.length, kept[0].company_name, kept[0].estimated_amount], [1, 'Kakedas', 9808]);
  check('移行: 照合済みフラグも残る', vm.runInContext('toBool_(readTable_(SHEETS.CALENDAR).rows[0].reconciled)', legacyContext), true);

  const wallRows = vm.runInContext('readTable_(SHEETS.WALLS).rows', legacyContext);
  check('移行: 既存の壁は重複せず、無い壁だけ追加される', wallRows.length, 3);
  check(
    '移行: 既存の123万円は編集済みの内容のまま（上書きされない）',
    wallRows.filter((r) => r.name === '123万円')[0].note,
    '所得税・扶養控除に関する壁の目安（自分で書き換えたメモ）'
  );
  check(
    '移行: 130万円・150万円が後から追加される',
    wallRows.map((r) => r.name).sort(),
    ['123万円', '130万円', '150万円（親の控除）']
  );
}

/* --- 制度変更で置き換わった壁の移行 --- */
{
  const wallEnv = makeSandbox({});
  const wallCtx = vm.createContext(wallEnv.sandbox);
  if (useBundle) {
    vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), wallCtx, { filename: 'all-in-one.gs' });
  } else {
    for (const file of files) vm.runInContext(readFileSync(join(root, file), 'utf8'), wallCtx, { filename: file });
  }
  const wRun = (expr) => vm.runInContext(expr, wallCtx);
  wRun('ensureSheets_({ force: true })');

  // 旧名の「150万円」だけがある状態を作る
  wRun(`getSheet_(SHEETS.WALLS).clear(); invalidateSheetCaches_();`);
  wRun(`ensureSheets_({ force: true })`);
  const seeded = wRun('readTable_(SHEETS.WALLS).rows.map(function(r){return r.name;}).sort()');
  check('壁の移行: 初期状態は3つ', seeded, ['123万円', '130万円', '150万円（親の控除）']);

  // 旧名で入っている場合、新しい壁を足すときに置き換わる
  wRun(`getSheet_(SHEETS.WALLS).clear(); invalidateSheetCaches_(); ensureSheets_({ force: true });`);
  wRun(`
    var sheet = getSheet_(SHEETS.WALLS);
    sheet.clear();
    invalidateSheetCaches_();
    getSheet_(SHEETS.WALLS);
    refreshHeaderLabels_();
    appendRows_(SHEETS.WALLS, [
      { name: '123万円', amount: 1230000, applicable_year: 2026, last_updated: '2026-08-22', note: '自分のメモ' },
      { name: '150万円', amount: 1500000, applicable_year: 2026, last_updated: '2026-08-22', note: '旧名' }
    ]);
  `);
  wRun('seedWallThresholds_()');
  const migrated = wRun('readTable_(SHEETS.WALLS).rows');
  check(
    '壁の移行: 旧名「150万円」が「150万円（親の控除）」に置き換わる',
    migrated.map((r) => r.name).sort(),
    ['123万円', '130万円', '150万円（親の控除）']
  );
  check('壁の移行: 重複して残らない', migrated.filter((r) => String(r.name) === '150万円').length, 0);
  check(
    '壁の移行: 自分で書いた既存の壁のメモは消えない',
    migrated.filter((r) => r.name === '123万円')[0].note,
    '自分のメモ'
  );

  // 2回目以降は何も起きない
  const before = wRun('readTable_(SHEETS.WALLS).rows.length');
  wRun('seedWallThresholds_()');
  check('壁の移行: 繰り返し実行しても変わらない', wRun('readTable_(SHEETS.WALLS).rows.length'), before);
}

console.log(details.join('\n'));
const label = useBundle ? '結合テスト(1ファイル版)' : '結合テスト';
const summary = failed === 0 ? `${label}: 全${details.length}件成功` : `${label}: ${failed}件失敗 / 全${details.length}件`;
console.log('\n' + summary);
process.exit(failed === 0 ? 0 : 1);
