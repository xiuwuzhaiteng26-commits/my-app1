/**
 * 実データの初期投入
 *
 * カレンダーに入っていない過去の確定収入と、既に働いた分のシフトを一括で登録する。
 * メニュー「実データを取り込む（初回のみ）」から実行する。
 *
 * 何度実行しても重複しない（同じキーの行を上書きする）。
 * カレンダーから同じ日を取り込んだ場合は、カレンダー側の行が優先される。
 */

/**
 * カレンダー化されていない収入（確定額）
 *
 * ここは空のまま公開リポジトリに置いています。実際の金額は個人情報なので、
 * 自分の Apps Script プロジェクト側でだけ中身を書いてください。
 *
 * 書き方:
 *   {
 *     source_name: '〇〇株式会社',
 *     income_category: '給与所得',        // 給与所得 / 事業所得 / 雑所得
 *     period: '2026-03〜2026-05',        // 年が分かる形で
 *     amount: 100000,                    // 額面（円）
 *     expenses: 0,                       // 必要経費（円）。給与所得なら0
 *     note: '3月分〜5月分'
 *   }
 */
var SEED_MANUAL_INCOME = [];

/**
 * カレンダーに入っていない、既に働いた分のシフト
 * [日付, 勤務先, 開始, 終了, 休憩(h), 時給(円)]
 *
 * 書き方:
 *   ['2026-06-10', '〇〇', '09:00', '18:00', 1, 1200]
 */
var SEED_SHIFTS = [];

/** 同じ勤務を指すかどうかの判定キー */
function shiftKey_(date, companyName, startTime) {
  return toDateString_(date) + '\t' + String(companyName).trim() + '\t' + toTimeString_(startTime);
}

/** メニューから呼ぶ本体 */
function importSeedData() {
  ensureSheets_();
  if (SEED_MANUAL_INCOME.length === 0 && SEED_SHIFTS.length === 0) {
    showAlert_(
      '登録するデータがありません',
      'SeedData の SEED_MANUAL_INCOME と SEED_SHIFTS に、収入とシフトを書いてから実行してください。'
    );
    return null;
  }
  var manual = seedManualIncome_();
  var shifts = seedShifts_();

  recalcReconciliations_();
  var snapshot = buildSnapshot_(new Date(), null);
  writeSummarySheet_(snapshot);

  var message =
    '手入力の収入: ' + manual.inserted + '件追加 / ' + manual.updated + '件更新\n' +
    'シフト: ' + shifts.inserted + '件追加 / ' + shifts.updated + '件更新' +
    (shifts.skipped ? ' / ' + shifts.skipped + '件はカレンダー取り込み済みのため見送り' : '');
  writeLog_('seed', '正常', message.replace(/\n/g, ' '));
  showSummaryAlert_('実データを取り込みました\n\n' + message, snapshot);
  return snapshot;
}

/** 確定収入を登録（収入元＋対象期間をキーに上書き） */
function seedManualIncome_() {
  var now = formatDateTime_(new Date());
  var rows = SEED_MANUAL_INCOME.map(function (item) {
    return {
      id: 'seed-manual\t' + item.source_name + '\t' + item.period,
      source_name: item.source_name,
      income_category: item.income_category,
      period: item.period,
      amount: item.amount,
      expenses: item.expenses,
      note: item.note,
      updated_at: now
    };
  });
  return upsertRows_(SHEETS.MANUAL, rows, 'id');
}

/** シフトを勤務明細に登録（カレンダーから取り込み済みの勤務は触らない） */
function seedShifts_() {
  var now = formatDateTime_(new Date());
  var existing = {};
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    existing[shiftKey_(r.date, r.company_name, r.start_time)] = String(r.id);
  });

  var rows = [];
  var skipped = 0;
  SEED_SHIFTS.forEach(function (shift) {
    var date = shift[0];
    var companyName = shift[1];
    var startTime = shift[2];
    var endTime = shift[3];
    var breakHours = shift[4];
    var hourlyWage = shift[5];
    var id = 'seed-shift\t' + date + '\t' + companyName + '\t' + startTime;
    var already = existing[shiftKey_(date, companyName, startTime)];
    if (already && already !== id) {
      // 同じ勤務がカレンダーから取り込まれている。二重計上を避けるため登録しない
      skipped++;
      return;
    }
    var workedHours = computeWorkedHours_(startTime, endTime, breakHours);
    rows.push({
      id: id,
      date: date,
      company_name: companyName,
      start_time: startTime,
      end_time: endTime,
      break_hours: breakHours,
      worked_hours: round2_(workedHours),
      hourly_wage: hourlyWage,
      estimated_amount: computeEstimatedAmount_(workedHours, hourlyWage),
      reconciled: false,
      source_title: '手入力（会話で確定した実績）',
      updated_at: now
    });
  });

  var result = upsertRows_(SHEETS.CALENDAR, rows, 'id', function (before, after) {
    var merged = {};
    Object.keys(after).forEach(function (k) {
      merged[k] = after[k];
    });
    merged.reconciled = toBool_(before.reconciled);
    return merged;
  });
  ensureCompanyLimits_(
    rows.map(function (r) {
      return r.company_name;
    })
  );
  result.skipped = skipped;
  return result;
}

/**
 * カレンダーから取り込む勤務と同じ勤務を指す手入力行を削除する。
 * 同じ日・同じ勤務先・同じ開始時刻ならカレンダー側を正とし、二重計上を防ぐ。
 */
function removeSeededDuplicates_(entries) {
  if (!entries || entries.length === 0) return 0;
  var wanted = {};
  entries.forEach(function (e) {
    wanted[shiftKey_(e.date, e.company_name, e.start_time)] = String(e.id);
  });

  var sheet = getSheet_(SHEETS.CALENDAR);
  var remove = [];
  readTable_(SHEETS.CALENDAR).rows.forEach(function (r) {
    var key = shiftKey_(r.date, r.company_name, r.start_time);
    if (wanted[key] && String(r.id) !== wanted[key]) remove.push(r._rowIndex);
  });
  remove
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (rowIndex) {
      sheet.deleteRow(rowIndex);
    });
  return remove.length;
}
