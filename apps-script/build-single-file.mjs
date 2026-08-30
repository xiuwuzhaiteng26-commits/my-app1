/**
 * 全部入りの1ファイル版を生成する。
 *
 *   npm run build:apps-script
 *
 * 出力: apps-script/dist/all-in-one.gs
 * Apps Script エディタにこの1ファイルを貼り付けるだけで動くように、
 * すべての .js と .html を1本にまとめる。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** 読み込む順番（CONFIG や SCHEMA の定義を先に置く） */
export const SOURCE_FILES = [
  'Config.js',
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
  'WebApp.js',
  'Main.js',
  'Tests.js'
];

const HTML_FILES = ['App', 'Reconcile'];

export function buildSingleFile(root = here) {
  const parts = [];
  parts.push(
    [
      '/**',
      ' * 年収の壁・労働時間管理ツール（全部入り1ファイル版）',
      ' *',
      ' * このファイルは自動生成です。直接編集せず、apps-script/ の各ファイルを直して',
      ' * `npm run build:apps-script` で作り直してください。',
      ' *',
      ' * 使い方: Apps Script エディタのファイルにこの内容をすべて貼り付けて保存する。',
      ' * 別途 appsscript.json のタイムゾーンを Asia/Tokyo にしておくこと。',
      ' */',
      ''
    ].join('\n')
  );

  for (const file of SOURCE_FILES) {
    const code = readFileSync(join(root, file), 'utf8').trimEnd();
    parts.push(`/* ======================= ${file} ======================= */\n\n${code}\n`);
  }

  const inline = HTML_FILES.map((name) => {
    const html = readFileSync(join(root, `${name}.html`), 'utf8');
    return `INLINE_HTML[${JSON.stringify(name)}] = ${JSON.stringify(html)};`;
  }).join('\n\n');
  parts.push(`/* ======================= HTML（画面） ======================= */\n\n${inline}\n`);

  return parts.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(here, 'dist', 'all-in-one.gs');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildSingleFile(), 'utf8');
  const lines = buildSingleFile().split('\n').length;
  console.log(`生成しました: apps-script/dist/all-in-one.gs（${lines}行）`);
}
