/**
 * テスト用の Google サービスの最小実装（SpreadsheetApp / CalendarApp など）。
 * 本物の Apps Script では使わない。
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  getValues() {
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

/** eventsByDate: { 'yyyy-MM-dd': [{id,title,...}] } */
export function makeSandbox(eventsByDate) {
  const spreadsheet = new FakeSpreadsheet();
  const sentMail = [];

  const formatDate = (date, _tz, format) => {
    const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (format === 'yyyy-MM-dd') return ymd;
    if (format === 'yyyy-MM') return ymd.slice(0, 7);
    if (format === 'HH:mm') return hm;
    return `${ymd} ${hm}:${pad(date.getSeconds())}`;
  };

  let uuid = 0;

  return {
    sandbox: {
      console,
      SpreadsheetApp: {
        getActiveSpreadsheet: () => spreadsheet
      },
      CalendarApp: {
        getDefaultCalendar: () => ({
          getEventsForDay: (date) => (eventsByDate[formatDate(date, null, 'yyyy-MM-dd')] || []).map((e) => new FakeEvent(e))
        }),
        getCalendarById: () => null
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
      Logger: { log: () => {} },
      ScriptApp: {
        getProjectTriggers: () => [],
        newTrigger: () => {
          throw new Error('テストではトリガーを作らない');
        }
      }
    },
    spreadsheet,
    sentMail
  };
}
