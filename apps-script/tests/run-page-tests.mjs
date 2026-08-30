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
  ],
  '2026-08-26': [
    {
      id: 'fixed-1',
      title: '[会社C] 09:00-19:00 休憩1h 時給1300円 支給15000円',
      start: new Date(2026, 7, 26, 9, 0),
      end: new Date(2026, 7, 26, 19, 0)
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
// 支給額つきの予定を先に取り込んでおく（画面表示の時点でシートに入っている状態にする）
vm.runInContext('importDateRange_(new Date(2026, 7, 26), new Date(2026, 7, 26))', ctx);
const html = vm.runInContext('doGet()', ctx).getContent();

/* ---- ブラウザ側を実行する ---- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check('画面: scriptブロックが2つある', scripts.length, 2);

const elements = {};
const played = [];
function fakeElement(id) {
  const classes = new Set();
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    className: '',
    currentTime: 0,
    style: {},
    dataset: {},
    listeners: {},
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    /** テストから発火させる */
    fire(type, event) {
      (this.listeners[type] || []).forEach((h) => h.call(this, event || { stopPropagation() {} }));
    },
    play() {
      played.push(this.id);
      return { catch() {} };
    },
    getAttribute: () => null,
    appendChild() {},
    classList: {
      toggle(name, on) { if (on === false) classes.delete(name); else classes.add(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains: (name) => classes.has(name)
    }
  };
}
const storage = {};
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
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => {
      storage[k] = String(v);
    },
    removeItem: (k) => {
      delete storage[k];
    }
  },
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
check('画面: 支給額の印を明細に出す', home.indexOf('支給額') > 0, true);
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
check('画面: 設定タブに給与サイクルを出す', settings.indexOf('給与サイクル') > 0, true);
check('画面: 締め日と支給日を読める形で出す', settings.indexOf('締め') > 0 && settings.indexOf('払い') > 0, true);

/* ---- 起動画面（エンジン音） ---- */
check('起動画面: 音のデータが埋め込まれている', html.indexOf('src="data:audio/mpeg;base64,') > 0, true);
check('起動画面: スタートボタンがある', html.indexOf('id="starter"') > 0, true);
const ignition = document.getElementById('ignition');
check('起動画面: 起動前は隠れていない', ignition.classList.contains('gone'), false);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

elements.starter.fire('click');
check('起動画面: 押すとエンジン音が鳴る', played, ['engine']);
check('起動画面: 押すとセルが回る見た目になる', elements.starter.classList.contains('cranking'), true);
await settle(1000);
check('起動画面: 音が鳴りだしてからアプリに入る', ignition.classList.contains('gone'), true);

// 音を消す設定は次回に引き継がれる
played.length = 0;
elements['mute-toggle'].fire('click');
check('起動画面: 音を消す設定を覚える', storage.engineSound, 'off');
check('起動画面: ボタンの文字が変わる', elements['mute-toggle'].textContent, '音を出す');
elements.starter.fire('click');
check('起動画面: 音を消していれば鳴らさない', played, []);

/* ---- 振込予定・月ごとの見込み ---- */
check('画面: 収入タブに振込予定を出す', income.indexOf('振込予定') > 0, true);
check('画面: 支給日を曜日つきで出す', /\d+月\d+日（[日月火水木金土]）/.test(income), true);
check('画面: 締め期間を出す', income.indexOf('の分') > 0, true);

// 同期後の見込みは、月ごとに分かれて表示される
pageSandbox.__synced = synced;
vm.runInContext('DATA = __synced; render();', pageCtx);
const forecast2 = elements['view-forecast'] ? elements['view-forecast'].innerHTML : '';
check('画面: 見込みを月ごとに分ける', /\d{4}年\d+月/.test(forecast2), true);
check('画面: 月ごとの合計時間を出す', forecast2.indexOf('合計 ') > 0, true);

console.log(details.join('\n'));
const summary = failed === 0 ? `画面テスト: 全${details.length}件成功` : `画面テスト: ${failed}件失敗 / 全${details.length}件`;
console.log('\n' + summary);
process.exit(failed === 0 ? 0 : 1);
