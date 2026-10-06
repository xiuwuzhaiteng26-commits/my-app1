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
  'WebApp.js',
  'Main.js',
  'Tests.js'
];

const HTML_FILES = ['App', 'Reconcile'];

/**
 * ブロックコメント（/** … *\/）を、すべて // の行コメントに書き換える。
 *
 * 1ファイル版は利用者がまるごとコピーして貼り付ける。そのとき先頭の数行が
 * 抜けると、途中の「 * 説明文」の行から始まってしまい、Apps Script が
 * 「SyntaxError: Unexpected token '*' 行: 1」で読み込めなくなる。
 * 行コメントだけにしておけば、どこから貼り付けても * で始まる行が無くなる。
 * 元のファイルは読みやすさのため今のままにして、1ファイル版を作るときだけ変える。
 */
export function toLineComments(code, name = '') {
  const out = [];
  let inBlock = false;
  let blockIndent = '';
  for (const line of code.split('\n')) {
    const indent = line.match(/^\s*/)[0];
    const body = line.slice(indent.length);
    if (!inBlock) {
      if (!body.startsWith('/*')) {
        out.push(line);
        continue;
      }
      const head = body.startsWith('/**') ? 3 : 2;
      const end = body.indexOf('*/', head);
      if (end >= 0) {
        // 1行で閉じるコメント。後ろにコードが続く書き方はそのまま残す
        if (body.slice(end + 2).trim() !== '') {
          out.push(line);
          continue;
        }
        const text = body.slice(head, end).trim();
        out.push(indent + '//' + (text ? ' ' + text : ''));
        continue;
      }
      inBlock = true;
      blockIndent = indent;
      const text = body.slice(head).trim();
      if (text) out.push(indent + '// ' + text);
      continue;
    }
    const end = body.indexOf('*/');
    if (end >= 0) {
      if (body.slice(end + 2).trim() !== '') {
        throw new Error(`${name}: コメントの閉じ記号の後ろにコードがあります: ${line}`);
      }
      const text = body.slice(0, end).replace(/^\*\s?/, '').trimEnd();
      if (text.trim()) out.push(blockIndent + '// ' + text);
      inBlock = false;
      continue;
    }
    const text = body.replace(/^\*\s?/, '').trimEnd();
    out.push(blockIndent + '//' + (text ? ' ' + text : ''));
  }
  if (inBlock) throw new Error(`${name}: 閉じていないコメントがあります`);
  return out.join('\n');
}

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
    const code = toLineComments(readFileSync(join(root, file), 'utf8').trimEnd(), file);
    parts.push(`// ======================= ${file} =======================\n\n${code}\n`);
  }

  const inline = HTML_FILES.map((name) => {
    const html = readFileSync(join(root, `${name}.html`), 'utf8');
    return `INLINE_HTML[${JSON.stringify(name)}] = ${JSON.stringify(html)};`;
  }).join('\n\n');
  parts.push(`// ======================= HTML（画面） =======================\n\n${inline}\n`);

  return toLineComments(parts.join('\n'), 'all-in-one.gs');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(here, 'dist', 'all-in-one.gs');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildSingleFile(), 'utf8');
  const lines = buildSingleFile().split('\n').length;
  console.log(`生成しました: apps-script/dist/all-in-one.gs（${lines}行）`);
}
