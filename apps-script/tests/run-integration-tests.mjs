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
import { makeSandbox } from './fake-google.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const files = [
  'Config.js',
  'Util.js',
  'Sheets.js',
  'Parser.js',
  'Calc.js',
  'CalendarSource.js',
  'Summary.js',
  'Notify.js',
  'Reconcile.js',
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

const { sandbox, spreadsheet, sentMail } = makeSandbox(events);
const context = vm.createContext(sandbox);
for (const file of files) {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), context, { filename: file });
}
const run = (expr) => vm.runInContext(expr, context);

/* --- 初期セットアップ --- */
run('ensureSheets_()');
const sheetNames = spreadsheet.getSheets().map((s) => s.getName());
check('セットアップ: サマリーが先頭タブ', sheetNames[0], 'サマリー');
check('セットアップ: 既定の空シートを削除', sheetNames.indexOf('シート1'), -1);
check('セットアップ: 全テーブルを作成', [
  sheetNames.includes('calendar_income_entries'),
  sheetNames.includes('manual_income_entries'),
  sheetNames.includes('company_hour_limits'),
  sheetNames.includes('wall_thresholds'),
  sheetNames.includes('monthly_reconciliation')
], [true, true, true, true, true]);
check('セットアップ: 壁の初期値を投入', run('readTable_(SHEETS.WALLS).rows.length'), 2);
run('ensureSheets_()');
check('セットアップ: 再実行しても壁が増えない', run('readTable_(SHEETS.WALLS).rows.length'), 2);

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
run('getSheet_(SHEETS.CALENDAR).getRange(2, 10).setValue(true)'); // reconciled を立てておく
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
check('サマリー: 解析エラーは出さない（runInfo無し）', summaryText.includes('時給の記載'), false);

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
check('アプリ: 壁と労働時間を返す', [appData.walls.length, appData.hours.length], [2, 2]);
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

console.log(details.join('\n'));
const summary = failed === 0 ? `結合テスト: 全${details.length}件成功` : `結合テスト: ${failed}件失敗 / 全${details.length}件`;
console.log('\n' + summary);
process.exit(failed === 0 ? 0 : 1);
