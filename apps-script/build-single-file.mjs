/**
 * 全部入りの1ファイル版を生成する。
 *
 *   npm run build:apps-script
 *
 * 出力:
 *   apps-script/dist/all-in-one.gs      … 読める形のまま1本にまとめたもの
 *   apps-script/dist/all-in-one.min.gs  … 貼り付け用に小さくしたもの
 *
 * Apps Script エディタにこの1ファイルを貼り付けるだけで動くように、
 * すべての .js と .html を1本にまとめる。
 *
 * 貼り付け用（.min.gs）を作る理由:
 * 全部入りが300KBを超えたあたりから、コピーの途中で切れて貼り付けられない
 * ことが起きた（約170KBまでは問題なかった）。コメントと空白を取り、関数の中の
 * 変数名を短くし、利用者には不要なセルフテストを外して小さくする。
 * 動きは変わらないことを、同じ結合テスト・画面テストを流して確かめている。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify as minifyJs } from 'terser';
import { minify as minifyHtmlText } from 'html-minifier-terser';

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

/** 貼り付け用から外すファイル（利用者には不要で、大きいもの） */
const MIN_EXCLUDE = ['Tests.js'];

/**
 * 画面のHTMLを小さくする。
 * <?!= 名前 ?> は Apps Script が表示のときに差し込む印なので、小さくする間だけ
 * ただの文字列に置き換えて守り、最後に元へ戻す。
 */
export async function minifyHtml(html, name = '') {
  if (/<\?(?!!=\s*\w+\s*\?>)/.test(html)) {
    throw new Error(`${name}: <?!= 名前 ?> 以外の差し込みタグには対応していません`);
  }
  const guarded = html.replace(/<\?!=\s*(\w+)\s*\?>/g, (_, n) => `__GAS_${n}__`);
  const out = await minifyHtmlText(guarded, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    minifyCSS: true,
    // 差し込み前の印を定数として計算してしまわないよう、圧縮(compress)はしない
    minifyJS: { compress: false, mangle: true, format: { comments: false } }
  });
  if (/__GAS_\w+__/.test(out) === false && /__GAS_/.test(guarded)) {
    throw new Error(`${name}: 差し込みタグが消えました`);
  }
  return out.replace(/__GAS_(\w+)__/g, (_, n) => `<?!= ${n} ?>`);
}

/**
 * 貼り付け用の小さい1ファイル版を作る。
 * transform で、小さくする前のコードに手を加えられる（個人用のデータを差し込むため）。
 */
export async function buildMinified({ root = here, transform = (code) => code } = {}) {
  const sources = SOURCE_FILES.filter((f) => MIN_EXCLUDE.indexOf(f) < 0)
    .map((file) => readFileSync(join(root, file), 'utf8').trimEnd())
    .join('\n\n');
  const inline = [];
  for (const name of HTML_FILES) {
    const html = await minifyHtml(readFileSync(join(root, `${name}.html`), 'utf8'), name);
    inline.push(`INLINE_HTML[${JSON.stringify(name)}] = ${JSON.stringify(html)};`);
  }
  const code = transform(sources + '\n\n' + inline.join('\n'));
  const result = await minifyJs(code, {
    // 一番外側の関数名・変数名は、メニューやトリガー・画面から名前で呼ばれるので変えない
    toplevel: false,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false, max_line_len: 1000 }
  });
  const header = [
    '// 年収の壁・労働時間管理ツール（貼り付け用・小さくした版）',
    '// 中身を全部コピーして、Apps Script の コード.gs に貼り付けてください。',
    '// 読める形の元のコードは apps-script/ にあります。ここは直接書き換えないでください。',
    ''
  ].join('\n');
  // 貼り付けが途中で切れていないかを、利用者が目で確かめられるようにする
  const footer = '\n// ===== ここが最後の行です。この行が見えていれば、全部貼り付けできています =====\n';
  return header + result.code + footer;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(here, 'dist', 'all-in-one.gs');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildSingleFile(), 'utf8');
  const lines = buildSingleFile().split('\n').length;
  console.log(`生成しました: apps-script/dist/all-in-one.gs（${lines}行）`);
  const min = await buildMinified();
  writeFileSync(join(here, 'dist', 'all-in-one.min.gs'), min, 'utf8');
  console.log(`生成しました: apps-script/dist/all-in-one.min.gs（${Math.round(min.length / 1024)}KB・${min.split('\n').length}行）`);
}
