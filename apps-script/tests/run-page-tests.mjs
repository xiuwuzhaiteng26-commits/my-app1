/**
 * アプリ画面（App.html）のJavaScriptを実際に動かすテスト。
 *
 *   node apps-script/tests/run-page-tests.mjs
 *
 * doGet が返すHTMLからスクリプトを取り出し、最小限のDOMの偽物の上で実行する。
 * 「サーバー側は正しいのに、画面が読み込み中のまま固まる」種類の不具合を捕まえるためのもの。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { makeSandbox } from './fake-google.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const details = [];
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) details.push('OK   ' + name);
  else {
    failed++;
    details.push(`FAIL ${name} : ${a} != ${e}`);
  }
}

/* ---- サーバー側でページを生成する ---- */
const env = makeSandbox({
  '2026-08-25': [
    {
      id: 'plan-1',
      title: '[会社A] 09:00-18:00 休憩1h 時給1200円',
      start: new Date(2026, 7, 25, 9, 0),
      end: new Date(2026, 7, 25, 18, 0)
    }
  ]
});
const ctx = vm.createContext(env.sandbox);
vm.runInContext(readFileSync(join(root, 'dist', 'all-in-one.gs'), 'utf8'), ctx, { filename: 'all-in-one.gs' });
vm.runInContext('setupSheets()', ctx);
// タブ区切りのキーや記号を含むデータでも壊れないことを見る
vm.runInContext(
  `SEED_MANUAL_INCOME = [{ source_name: '"引用符" と \\\\ と ' + String.fromCharCode(39) + 'アポストロフィ', income_category: '事業所得', period: '2026-03', amount: 50000, expenses: 1000, note: '改行\\nタブ\\tを含むメモ' }];
   SEED_SHIFTS = [
     ['2026-08-01', '会社A', '09:00', '18:00', 1, 1200],
     ['2026-08-02', '会社B', '10:00', '16:00', 0, 1500, 1000]
   ];
   importSeedData();`,
  ctx
);
const html = vm.runInContext('doGet()', ctx).getContent();

/* ---- ブラウザ側を実行する ---- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check('画面: scriptブロックが2つある', scripts.length, 2);

const elements = {};
function fakeElement(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    className: '',
    style: {},
    dataset: {},
    addEventListener() {},
    getAttribute: () => null,
    appendChild() {},
    classList: { toggle() {}, add() {}, remove() {} }
  };
}
const document = {
  getElementById(id) {
    if (!elements[id]) elements[id] = fakeElement(id);
    return elements[id];
  },
  querySelectorAll: () => [],
  createElement: (tag) => fakeElement(tag)
};
const errors = [];
const serverCalls = [];
const pageSandbox = {
  document,
  console,
  setTimeout,
  clearTimeout,
  window: {
    addEventListener(type, handler) {
      if (type === 'error') pageSandbox.__onerror = handler;
    }
  },
  google: {
    script: {
      // 本物と同じく、withSuccessHandler などを繋いだあとに
      // 任意のサーバー関数名を呼べるようにする（呼び出しは記録するだけ）
      run: (() => {
        const proxy = new Proxy(
          {},
          {
            get(_target, prop) {
              if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
                return () => proxy;
              }
              return (...args) => {
                serverCalls.push({ name: String(prop), args });
                return proxy;
              };
            }
          }
        );
        return proxy;
      })()
    }
  }
};
const pageCtx = vm.createContext(pageSandbox);

scripts.forEach((code, i) => {
  try {
    vm.runInContext(code, pageCtx, { filename: `App.html script#${i + 1}` });
  } catch (e) {
    errors.push(e.message);
  }
});

check('画面: スクリプトが例外なく動く', errors, []);
let targetYear = null;
try {
  targetYear = vm.runInContext('DATA.targetYear', pageCtx);
} catch (e) {
  targetYear = 'DATA が読めない: ' + e.message;
}
check('画面: データを読み込めている', targetYear, 2026);
const statusHtml = elements.updated ? elements.updated.innerHTML : '';
check('画面: 初期の「読み込み中」から進む', statusHtml.indexOf('読み込み中') < 0, true);
check('画面: 表示直後は同期中と分かる', statusHtml.indexOf('カレンダーを確認中') > 0, true);
check('画面: 免責を表示する', elements.disclaimer && elements.disclaimer.textContent.indexOf('【免責】'), 0);

const home = elements['view-home'] ? elements['view-home'].innerHTML : '';
check('画面: ホームに年間収入を出す', home.indexOf('年の収入（額面）') > 0, true);
check('画面: ホームに壁までの残りを出す', home.indexOf('壁までの残り') > 0, true);
check('画面: 壁を全部並べる', home.indexOf('123万円') > 0 && home.indexOf('130万円') > 0, true);
check('画面: 手当を明細に出す', home.indexOf('手当') > 0, true);
check('画面: ホームに当月の労働時間を出す', home.indexOf('今月') > 0, true);

const income = elements['view-income'] ? elements['view-income'].innerHTML : '';
check('画面: 収入タブに合計所得金額を出す', income.indexOf('合計所得金額') > 0, true);
check('画面: 記号を含む収入元をそのまま壊さず表示', income.indexOf('&quot;引用符&quot;') > 0, true);

const forecast = elements['view-forecast'] ? elements['view-forecast'].innerHTML : '';
check('画面: 初回表示では見込みを読み込み中にする', forecast.indexOf('読み込んでいます') > 0, true);
check('画面: 表示後にカレンダーの同期を呼ぶ', serverCalls.map((c) => c.name), ['appSyncCalendar']);

// 同期後のデータでは見込みが埋まること（サーバー側の戻り値で確認）
const synced = vm.runInContext('appSyncCalendar()', ctx);
check('同期後: 見込みが利用可能になる', synced.forecast.available, true);
check('同期後: アドバイスが入る', synced.forecast.advice.length > 0, true);

const settings = elements['view-settings'] ? elements['view-settings'].innerHTML : '';
check('画面: 設定タブに勤務先の上限を出す', settings.indexOf('会社A') > 0, true);

console.log(details.join('\n'));
const summary = failed === 0 ? `画面テスト: 全${details.length}件成功` : `画面テスト: ${failed}件失敗 / 全${details.length}件`;
console.log('\n' + summary);
process.exit(failed === 0 ? 0 : 1);
