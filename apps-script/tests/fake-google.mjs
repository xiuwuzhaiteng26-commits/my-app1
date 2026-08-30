/**
 * テスト用の Google サービスの最小実装（SpreadsheetApp / CalendarApp など）。
 * 本物の Apps Script では使わない。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Google API の呼び出し回数を数えるカウンタ。
 * Apps Script では SpreadsheetApp / CalendarApp の1回1回が遅いため、
 * 「何回呼んだか」が体感速度にほぼ直結する。最適化の効果をこれで測る。
 */
export const apiCalls = {
  sheetRead: 0,
  sheetWrite: 0,
  calendarFetch: 0,
  reset() {
    apiCalls.sheetRead = 0;
    apiCalls.sheetWrite = 0;
    apiCalls.calendarFetch = 0;
  },
  get total() {
    return apiCalls.sheetRead + apiCalls.sheetWrite + apiCalls.calendarFetch;
  }
};

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
    apiCalls.sheetRead++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const rowData = this.sheet.data[this.row - 1 + r] || [];
        const v = rowData[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    apiCalls.sheetWrite++;
    this.sheet.writes = (this.sheet.writes || 0) + 1;
    if (values.length !== this.numRows) throw new Error('行数が一致しません');
    values.forEach((line, r) => {
      if (line.length !== this.numCols) throw new Error('列数が一致しません');
      const target = this.row - 1 + r;
      while (this.sheet.data.length <= target) this.sheet.data.push([]);
      line.forEach((v, c) => {
        this.sheet.data[target][this.col - 1 + c] = v;
      });
    });
    return this;
  }
  setValue(v) {
    return this.setValues([[v]]);
  }
  merge() {
    return this;
  }
  breakApart() {
    return this;
  }
  setFontWeight() {
    return this;
  }
  setBackground() {
    return this;
  }
  setFontColor() {
    return this;
  }
  setWrap() {
    return this;
  }
  setNumberFormat() {
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  getName() {
    return this.name;
  }
  setName(name) {
    this.name = name;
    return this;
  }
  getMaxRows() {
    return 1000;
  }
  getLastRow() {
    let last = 0;
    this.data.forEach((line, i) => {
      if (line && line.some((v) => v !== '' && v !== undefined && v !== null)) last = i + 1;
    });
    return last;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  appendRow(values) {
    this.data[this.getLastRow()] = values.slice();
    return this;
  }
  deleteRow(row) {
    return this.deleteRows(row, 1);
  }
  deleteRows(start, count) {
    this.data.splice(start - 1, count);
    return this;
  }
  clear() {
    this.data = [];
    return this;
  }
  setFrozenRows() {
    return this;
  }
  setColumnWidth() {
    return this;
  }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = [new FakeSheet('シート1')];
    this.toasts = [];
  }
  getUrl() {
    return 'https://docs.google.com/spreadsheets/d/fake/edit';
  }
  getSpreadsheetTimeZone() {
    return 'Asia/Tokyo';
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.getName() === name) || null;
  }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  getSheets() {
    return this.sheets.slice();
  }
  deleteSheet(sheet) {
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
  setActiveSheet(sheet) {
    this.active = sheet;
    return sheet;
  }
  moveActiveSheet(pos) {
    this.sheets = [this.active].concat(this.sheets.filter((s) => s !== this.active));
    return pos;
  }
  toast(message) {
    this.toasts.push(message);
  }
}

class FakeEvent {
  constructor({ id, title, start, end, allDay = false }) {
    this.id = id;
    this.title = title;
    this.start = start;
    this.end = end;
    this.allDay = allDay;
  }
  getId() {
    return this.id;
  }
  getTitle() {
    return this.title;
  }
  isAllDayEvent() {
    return this.allDay;
  }
  getStartTime() {
    return this.start;
  }
  getEndTime() {
    return this.end;
  }
}

/** Apps Script が addMetaTag で受け付けるメタタグ（これ以外は例外になる） */
const ALLOWED_META_TAGS = [
  'viewport',
  'mobile-web-app-capable',
  'apple-mobile-web-app-capable',
  'google-site-verification'
];

function makeHtmlOutput(content) {
  const output = {
    content,
    title: '',
    metaTags: [],
    getContent: () => output.content,
    getTitle: () => output.title,
    setTitle(title) {
      output.title = title;
      return output;
    },
    addMetaTag(name, value) {
      if (ALLOWED_META_TAGS.indexOf(name) < 0) {
        throw new Error('指定したメタタグはこのコンテキストでは使用できません。');
      }
      output.metaTags.push([name, value]);
      return output;
    },
    setWidth: () => output,
    setHeight: () => output,
    setXFrameOptionsMode: () => output
  };
  return output;
}

/** テンプレート（<?!= 変数 ?> だけを差し替える簡易版） */
function makeHtmlTemplate(content) {
  const template = {
    evaluate() {
      const rendered = content.replace(/<\?!?=\s*([A-Za-z_$][\w$]*)\s*\?>/g, (_, name) =>
        template[name] === undefined ? '' : String(template[name])
      );
      return makeHtmlOutput(rendered);
    }
  };
  return template;
}

const formatDate = (date, _tz, format) => {
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (format === 'yyyy-MM-dd') return ymd;
  if (format === 'yyyy-MM') return ymd.slice(0, 7);
  if (format === 'HH:mm') return hm;
  return `${ymd} ${hm}:${pad(date.getSeconds())}`;
};

function makeFakeCalendar(eventsByDate) {
  return {
    getEventsForDay: (date) => (eventsByDate[formatDate(date, null, 'yyyy-MM-dd')] || []).map((e) => new FakeEvent(e)),
    getEvents: (start, end) => {
      apiCalls.calendarFetch++;
      return Object.keys(eventsByDate)
        .sort()
        .reduce((all, key) => all.concat(eventsByDate[key]), [])
        .filter((e) => e.start >= start && e.start < end)
        .map((e) => new FakeEvent(e));
    }
  };
}

/**
 * eventsByDate: { 'yyyy-MM-dd': [{id,title,...}] } … 既定カレンダー（primary）の予定
 * otherCalendars: { 'カレンダーID': { 'yyyy-MM-dd': [...] } } … 共有カレンダーの予定。
 *   未知の calendarId は getCalendarById が null を返す（＝見つからない扱い）。
 */
export function makeSandbox(eventsByDate, otherCalendars) {
  otherCalendars = otherCalendars || {};
  const spreadsheet = new FakeSpreadsheet();
  const sentMail = [];
  const alerts = [];
  const menu = { items: [] };
  const dialogs = [];
  const ui = {
    alert: (message) => alerts.push(message),
    showModalDialog: (output, title) => dialogs.push({ title, content: output.getContent() }),
    createMenu(name) {
      menu.name = name;
      const builder = {
        addItem(label, fn) {
          menu.items.push({ label, fn });
          return builder;
        },
        addSeparator: () => builder,
        addToUi: () => menu
      };
      return builder;
    }
  };

  const scriptProperties = {};
  let uuid = 0;

  return {
    sandbox: {
      console,
      SpreadsheetApp: {
        getActiveSpreadsheet: () => spreadsheet,
        getUi: () => ui
      },
      CalendarApp: {
        getDefaultCalendar: () => makeFakeCalendar(eventsByDate),
        getCalendarById: (id) => (otherCalendars[id] ? makeFakeCalendar(otherCalendars[id]) : null)
      },
      Utilities: {
        formatDate,
        getUuid: () => `uuid-${++uuid}`
      },
      Session: {
        getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }),
        getScriptTimeZone: () => 'Asia/Tokyo'
      },
      MailApp: { sendEmail: (to, subject, body) => sentMail.push({ to, subject, body }) },
      UrlFetchApp: { fetch: () => ({}) },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key) => (key in scriptProperties ? scriptProperties[key] : null),
          setProperty: (key, value) => {
            scriptProperties[key] = String(value);
          },
          deleteProperty: (key) => {
            delete scriptProperties[key];
          }
        })
      },
      HtmlService: {
        createTemplate: (html) => makeHtmlTemplate(html),
        createTemplateFromFile: (name) => makeHtmlTemplate(`<!-- ${name} -->`),
        createHtmlOutput: (html) => makeHtmlOutput(html),
        createHtmlOutputFromFile: (name) => makeHtmlOutput(`<!-- ${name} -->`)
      },
      Logger: { log: () => {} },
      ScriptApp: {
        getProjectTriggers: () => [],
        newTrigger: () => {
          throw new Error('テストではトリガーを作らない');
        }
      }
    },
    spreadsheet,
    sentMail,
    alerts,
    menu,
    dialogs,
    scriptProperties
  };
}

/**
 * 日本の祝日カレンダーの偽物。
 * makeSandbox の otherCalendars に、祝日カレンダーIDのキーで渡して使う。
 *
 *   makeSandbox({}, { [HOLIDAY_CALENDAR_ID]: holidayFixture([2025, 2026, 2027]) })
 */
export const HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

/** 年ごとの祝日（月/日と名前）。振替休日など、テストに必要な範囲で持つ */
const HOLIDAYS_BY_YEAR = {
  2025: [
    ['01-01', '元日'], ['01-13', '成人の日'], ['02-11', '建国記念の日'], ['02-23', '天皇誕生日'],
    ['02-24', '休日'], ['03-20', '春分の日'], ['04-29', '昭和の日'], ['05-03', '憲法記念日'],
    ['05-04', 'みどりの日'], ['05-05', 'こどもの日'], ['05-06', '休日'], ['07-21', '海の日'],
    ['08-11', '山の日'], ['09-15', '敬老の日'], ['09-23', '秋分の日'], ['10-13', 'スポーツの日'],
    ['11-03', '文化の日'], ['11-23', '勤労感謝の日'], ['11-24', '休日']
  ],
  2026: [
    ['01-01', '元日'], ['01-12', '成人の日'], ['02-11', '建国記念の日'], ['02-23', '天皇誕生日'],
    ['03-20', '春分の日'], ['04-29', '昭和の日'], ['05-03', '憲法記念日'], ['05-04', 'みどりの日'],
    ['05-05', 'こどもの日'], ['05-06', '休日'], ['07-20', '海の日'], ['08-11', '山の日'],
    ['09-21', '敬老の日'], ['09-22', '休日'], ['09-23', '秋分の日'], ['10-12', 'スポーツの日'],
    ['11-03', '文化の日'], ['11-23', '勤労感謝の日']
  ],
  2027: [
    ['01-01', '元日'], ['01-11', '成人の日'], ['02-11', '建国記念の日'], ['02-23', '天皇誕生日'],
    ['03-21', '春分の日'], ['03-22', '休日'], ['04-29', '昭和の日'], ['05-03', '憲法記念日'],
    ['05-04', 'みどりの日'], ['05-05', 'こどもの日'], ['07-19', '海の日'], ['08-11', '山の日'],
    ['09-20', '敬老の日'], ['09-23', '秋分の日'], ['10-11', 'スポーツの日'], ['11-03', '文化の日'],
    ['11-23', '勤労感謝の日']
  ]
};

export function holidayFixture(years) {
  const byDate = {};
  (years || [2025, 2026, 2027]).forEach((year) => {
    (HOLIDAYS_BY_YEAR[year] || []).forEach(([md, name]) => {
      const key = `${year}-${md}`;
      const [m, d] = md.split('-').map(Number);
      byDate[key] = [{ id: `holiday-${key}`, title: name, start: new Date(year, m - 1, d, 0, 0), end: new Date(year, m - 1, d, 23, 59) }];
    });
  });
  return byDate;
}
