/**
 * Apps Script のロジックを node で実行するテストランナー。
 *
 *   node apps-script/tests/run-node-tests.mjs
 *
 * Google のサービス（SpreadsheetApp / CalendarApp など）は呼ばない、
 * 純粋なロジック（Tests.js の runTests）だけを実行する。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const files = [
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
  'Main.js',
  'WebApp.js',
  'Tests.js'
];

// GAS のグローバルの最小限のスタブ（日付整形のみ使う）
const sandbox = {
  console,
  Utilities: {
    formatDate(date, _tz, format) {
      const pad = (n) => String(n).padStart(2, '0');
      const map = {
        'yyyy-MM-dd': `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        'yyyy-MM': `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
        'HH:mm': `${pad(date.getHours())}:${pad(date.getMinutes())}`
      };
      if (map[format]) return map[format];
      return `${map['yyyy-MM-dd']} ${map['HH:mm']}:${pad(date.getSeconds())}`;
    },
    getUuid: () => 'test-uuid'
  },
  Logger: { log: console.log }
};

const context = vm.createContext(sandbox);
for (const file of files) {
  const code = readFileSync(join(root, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}

const result = vm.runInContext('runTests()', context);
console.log(result.details.join('\n'));
console.log('\n' + result.summary);
process.exit(result.failed === 0 ? 0 : 1);
