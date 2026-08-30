/**
 * セルフテスト（スプレッドシートに触らない純粋なロジックのみ）
 * GASのメニュー「セルフテストを実行」からも、ローカルの node からも実行できる。
 */

function runTests() {
  var details = [];
  var failed = 0;

  function check(name, actual, expected) {
    var a = JSON.stringify(actual);
    var e = JSON.stringify(expected);
    if (a === e) {
      details.push('OK   ' + name);
    } else {
      failed++;
      details.push('FAIL ' + name + ' : ' + a + ' != ' + e);
    }
  }

  /* --- タイトル解析 --- */
  var p1 = parseWorkEventTitle_('[Kakedas] 09:00-18:00 休憩1h 時給1226円');
  check('基本形: 会社名', p1.companyName, 'Kakedas');
  check('基本形: 時刻', [p1.startTime, p1.endTime], ['09:00', '18:00']);
  check('基本形: 休憩', p1.breakHours, 1);
  check('基本形: 時給', p1.hourlyWage, 1226);
  check('基本形: 警告なし', p1.warnings.length, 0);

  var p2 = parseWorkEventTitle_('[バイトレ] 13:00-17:00 休憩なし 時給1700円');
  check('休憩なし', [p2.ok, p2.breakHours, p2.hourlyWage], [true, 0, 1700]);

  var p3 = parseWorkEventTitle_('［Ｋａｋｅｄａｓ］ ０９：００−１８：００ 休憩１ｈ 時給１，２２６円');
  check('全角入力', [p3.ok, p3.companyName, p3.startTime, p3.endTime, p3.hourlyWage], [true, 'Kakedas', '09:00', '18:00', 1226]);

  check('休憩90分', parseWorkEventTitle_('[A] 09:00-18:00 休憩90分 時給1000円').breakHours, 1.5);
  check('休憩1時間30分', parseWorkEventTitle_('[A] 09:00-18:00 休憩1時間30分 時給1000円').breakHours, 1.5);
  check('休憩1.5h', parseWorkEventTitle_('[A] 09:00-18:00 休憩1.5h 時給1000円').breakHours, 1.5);
  check('休憩0.5h', parseWorkEventTitle_('[A] 09:00-18:00 休憩0.5h 時給1000円').breakHours, 0.5);
  check('休憩0分', parseWorkEventTitle_('[A] 09:00-18:00 休憩0分 時給1000円').breakHours, 0);
  check('波ダッシュ区切り', parseWorkEventTitle_('[A] 9:00〜18:00 休憩なし 時給1000円').startTime, '09:00');

  var p4 = parseWorkEventTitle_('[A] 09:00-18:00 時給1000円');
  check('休憩の記載なし: 0hで続行し警告', [p4.ok, p4.breakHours, p4.warnings.length], [true, 0, 1]);

  var p5 = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h');
  check('時給なし: エラー扱い', [p5.ok, p5.kind], [false, 'error']);

  var p6 = parseWorkEventTitle_('サークルの飲み会 19:00-22:00');
  check('[]なし: 勤務以外として無視', [p6.ok, p6.kind], [false, 'skip']);

  var p7 = parseWorkEventTitle_('[A] 休憩なし 時給1000円');
  check('タイトルに時刻なし: 予定の時刻を使う', [p7.ok, p7.hasTimeRange], [true, false]);

  /* --- 手当（単発バイトで出る固定額） --- */
  var al1 = parseWorkEventTitle_('[バイトレ] 09:00-17:00 休憩なし 時給1700円 手当1000円');
  check('手当: 基本形', [al1.ok, al1.allowance], [true, 1000]);
  check('手当: 交通費も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 交通費500円').allowance, 500);
  check('手当: 複数あれば合算', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当1000円 交通費500円').allowance, 1500);
  check('手当: 〇〇手当の形も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 食事手当800円').allowance, 800);
  check('手当: 日当も拾う', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 日当2000円').allowance, 2000);
  check('手当: プラス記号つき', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当+1,200円').allowance, 1200);
  check('手当: 手当なしは0', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当なし').allowance, 0);
  check('手当: 記載が無ければ0', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円').allowance, 0);
  check('手当: 全角でも拾う', parseWorkEventTitle_('［Ａ］ ０９：００−１７：００ 休憩なし 時給１０００円 手当１，０００円').allowance, 1000);
  check('手当: 時給と取り違えない', parseWorkEventTitle_('[A] 09:00-17:00 休憩なし 時給1000円 手当500円').hourlyWage, 1000);

  check('推定収入: 手当を足す', computeEstimatedAmount_(8, 1200, 1000), 8 * 1200 + 1000);
  check('推定収入: 手当が無くても従来どおり', computeEstimatedAmount_(8, 1200), 9600);
  check('推定収入: 手当だけの端数も四捨五入', computeEstimatedAmount_(0, 0, 1500), 1500);

  /* --- 支給額（残業などで時給×時間とずれた日を上書きする） --- */
  var fx1 = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給12000円');
  check('支給額: 基本形', [fx1.ok, fx1.hasFixedAmount, fx1.fixedAmount], [true, true, 12000]);
  check(
    '支給額: 「支給額」と書いてもよい',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給額12,500円').fixedAmount,
    12500
  );
  check(
    '支給額: 「合計」でも拾う',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 合計12500円').fixedAmount,
    12500
  );
  check(
    '支給額: 「給与」でも拾う',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 給与12500円').fixedAmount,
    12500
  );
  check(
    '支給額: 全角でも拾う',
    parseWorkEventTitle_('［Ａ］ ０９：００−１８：００ 休憩１ｈ 時給１２００円 支給１２，０００円').fixedAmount,
    12000
  );
  check(
    '支給額: 記載が無ければ使わない',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円').hasFixedAmount,
    false
  );
  check(
    '支給額: 時給を取り違えない',
    parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 支給12000円').hourlyWage,
    1200
  );
  var fxBoth = parseWorkEventTitle_('[A] 09:00-18:00 休憩1h 時給1200円 交通費800円 支給12000円');
  check('支給額: 手当と併記したら手当は足さない', [fxBoth.fixedAmount, fxBoth.allowance], [12000, 0]);
  check('支給額: 手当と併記したら注意を出す', fxBoth.warnings.length, 1);

  check('推定収入: 支給額があればそれを使う', computeEstimatedAmount_(8, 1200, 1000, 12000), 12000);
  check('推定収入: 支給額が0なら計算どおり', computeEstimatedAmount_(8, 1200, 1000, 0), 8 * 1200 + 1000);

  var fixedRows = [
    { date: '2026-08-01', company_name: 'A', worked_hours: 8, estimated_amount: 12000, allowance: 0, fixed_amount: 12000 },
    { date: '2026-08-02', company_name: 'A', worked_hours: 8, estimated_amount: 9600, allowance: 0, fixed_amount: 0 }
  ];
  var withFixed = aggregateAnnual_(fixedRows, [], 2026);
  check('支給額: 年間の収入に反映される', withFixed.calendarRevenue, 21600);
  check('支給額: 手当合計には入れない', withFixed.allowanceTotal, 0);

  var allowanceRows = [
    { date: '2026-08-01', company_name: 'A', worked_hours: 8, estimated_amount: 10600, allowance: 1000 },
    { date: '2026-08-02', company_name: 'A', worked_hours: 8, estimated_amount: 9600, allowance: 0 }
  ];
  var withAllowance = aggregateAnnual_(allowanceRows, [], 2026);
  check('手当: 年間の収入に含まれる', withAllowance.calendarRevenue, 20200);
  check('手当: 手当だけの合計も出す', withAllowance.allowanceTotal, 1000);

  /* --- 給与サイクル（締め日と支給日） --- */
  var cycleRegency = {
    companyName: 'R', cutoffDay: 20, payMonthOffset: 1, payDay: 10,
    shiftRule: PAY_SHIFT_EARLIER, shiftOnHoliday: true, confirmed: true
  };
  var noHolidays = {};

  check('締め日: 20日締めで20日は当月分', cutoffDateFor_('2026-04-20', 20), '2026-04-20');
  check('締め日: 20日締めで21日は翌月分', cutoffDateFor_('2026-03-21', 20), '2026-04-20');
  check('締め日: 月末締め（31指定）は月末に丸める', cutoffDateFor_('2026-02-10', 31), '2026-02-28');
  check('締め日: 月末締めで月末当日は当月分', cutoffDateFor_('2026-04-30', 31), '2026-04-30');
  check('締め日: 25日締めで26日は翌月分', cutoffDateFor_('2026-12-26', 25), '2027-01-25');

  check('支給日: 締めの翌月10日', scheduledPayDate_('2026-04-20', cycleRegency), '2026-05-10');
  check('支給日: 月末払い（31指定）は月末に丸める', scheduledPayDate_('2026-02-28', { payMonthOffset: 1, payDay: 31 }), '2026-03-31');

  // 実例: 3/21(土)〜4/20(月) に働いた分が 5/8(金) に支給された
  var real = resolvePayment_('2026-03-21', cycleRegency, noHolidays);
  check('実例: 締め期間', [real.periodFrom, real.periodTo], ['2026-03-21', '2026-04-20']);
  check('実例: 本来の支給日は5/10（日）', real.scheduledDate, '2026-05-10');
  check('実例: 前倒しで5/8（金）', real.payDate, '2026-05-08');
  check('実例: ずれたことが分かる', real.moved, true);
  check('実例: 期間の終わりの日も同じ支給日', resolvePayment_('2026-04-20', cycleRegency, noHolidays).payDate, '2026-05-08');
  check('実例: 期間の次の日は次の支給日', resolvePayment_('2026-04-21', cycleRegency, noHolidays).payDate, '2026-06-10');

  check('土日: 土曜は休み', isWeekend_('2026-05-09'), true);
  check('土日: 日曜は休み', isWeekend_('2026-05-10'), true);
  check('土日: 月曜は休みでない', isWeekend_('2026-05-11'), false);

  check('前倒し: 平日ならそのまま', adjustPayDate_('2026-05-08', PAY_SHIFT_EARLIER, true, {}), '2026-05-08');
  check('前倒し: 土曜なら金曜', adjustPayDate_('2026-05-09', PAY_SHIFT_EARLIER, true, {}), '2026-05-08');
  check('前倒し: 日曜なら金曜', adjustPayDate_('2026-05-10', PAY_SHIFT_EARLIER, true, {}), '2026-05-08');
  check(
    '前倒し: 平日の祝日なら直前の平日',
    adjustPayDate_('2026-11-03', PAY_SHIFT_EARLIER, true, { '2026-11-03': '文化の日' }),
    '2026-11-02'
  );
  check(
    '前倒し: 祝日を見ない設定なら動かさない',
    adjustPayDate_('2026-11-03', PAY_SHIFT_EARLIER, false, { '2026-11-03': '文化の日' }),
    '2026-11-03'
  );
  check(
    '前倒し: 連休は抜けるまで戻る',
    adjustPayDate_('2026-05-05', PAY_SHIFT_EARLIER, true, {
      '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日', '2026-05-05': 'こどもの日', '2026-05-06': '休日'
    }),
    '2026-05-01'
  );
  check('後ろ倒し: 土曜なら月曜', adjustPayDate_('2026-05-09', PAY_SHIFT_LATER, true, {}), '2026-05-11');
  check('そのまま: 日曜でも動かさない', adjustPayDate_('2026-05-10', PAY_SHIFT_NONE, true, {}), '2026-05-10');

  // 月末締め・翌月15日払い
  var cycleBeat = {
    companyName: 'B', cutoffDay: 31, payMonthOffset: 1, payDay: 15,
    shiftRule: PAY_SHIFT_EARLIER, shiftOnHoliday: true, confirmed: true
  };
  var beat = resolvePayment_('2026-08-20', cycleBeat, noHolidays);
  check('月末締め: 締め期間', [beat.periodFrom, beat.periodTo], ['2026-08-01', '2026-08-31']);
  check('月末締め: 翌月15日払い', beat.payDate, '2026-09-15');

  // 25日締め・翌月25日払い
  var cycleK = {
    companyName: 'K', cutoffDay: 25, payMonthOffset: 1, payDay: 25,
    shiftRule: PAY_SHIFT_EARLIER, shiftOnHoliday: true, confirmed: true
  };
  var k = resolvePayment_('2026-08-26', cycleK, noHolidays);
  check('25日締め: 26日は翌月の締め', [k.periodFrom, k.periodTo], ['2026-08-26', '2026-09-25']);
  check('25日締め: その翌月25日払い（10/25は日曜なので前倒し）', k.payDate, '2026-10-23');
  check('25日締め: 本来の支給日', k.scheduledDate, '2026-10-25');

  // 年をまたぐ支給
  var yearEnd = resolvePayment_('2026-12-05', cycleBeat, noHolidays);
  check('年またぎ: 12月の勤務が翌年1月払い', yearEnd.payDate, '2027-01-15');

  check('空欄判定: 0は空欄ではない', [isBlank_(0), isBlank_(''), isBlank_(null), isBlank_(undefined)], [false, true, true, true]);

  // 未登録の勤務先は暫定値
  var fallback = payCycleFor_({}, '知らない会社');
  check('未登録: 暫定値を使う', [fallback.cutoffDay, fallback.payDay, fallback.confirmed], [31, 25, false]);

  /* --- 支給日ベースの年間集計 --- */
  var payRows = [
    { date: '2026-12-05', company_name: 'B', worked_hours: 8, estimated_amount: 10000, allowance: 0 },
    { date: '2026-08-20', company_name: 'B', worked_hours: 8, estimated_amount: 20000, allowance: 0 }
  ];
  var resolveB = function (name, workDate) {
    return resolvePayment_(workDate, cycleBeat, noHolidays);
  };
  var byPay = aggregateAnnual_(payRows, [], 2026, resolveB);
  check('支給日ベース: 翌年払いは今年に入れない', byPay.calendarRevenue, 20000);
  check('支給日ベース: 翌年に回った分を数える', byPay.carriedOutRevenue, 10000);
  check('支給日ベース: 集計方法が分かる', byPay.byPayDate, true);
  check('勤務日ベース: 関数を渡さなければ従来どおり', aggregateAnnual_(payRows, [], 2026).calendarRevenue, 30000);
  var nextYear = aggregateAnnual_(payRows, [], 2027, resolveB);
  check('支給日ベース: 翌年の収入になる', nextYear.calendarRevenue, 10000);
  check('支給日ベース: 前年から繰り越した分を数える', nextYear.carriedInRevenue, 10000);

  /* --- 支給日ごとのまとめ --- */
  var payments = aggregatePayments_(payRows, resolveB, new Date(2026, 8, 30), 2026);
  check('振込予定: 2026年に振り込まれるのは1件', payments.length, 1);
  check('振込予定: 支給日と金額', [payments[0].payDate, payments[0].amount], ['2026-09-15', 20000]);
  check('振込予定: 支給済みか', payments[0].isPaid, true);
  var future = aggregatePayments_(payRows, resolveB, new Date(2026, 7, 1), 2026);
  check('振込予定: これからの分は未支給', future[0].isPaid, false);

  /* --- 実働時間・推定収入 --- */
  check('実働時間: 9:00-18:00 休憩1h', computeWorkedHours_('09:00', '18:00', 1), 8);
  check('実働時間: 13:00-17:00 休憩0', computeWorkedHours_('13:00', '17:00', 0), 4);
  check('実働時間: 日またぎ 22:00-06:00 休憩1h', computeWorkedHours_('22:00', '06:00', 1), 7);
  check('実働時間: 休憩が長すぎる場合は0', computeWorkedHours_('09:00', '10:00', 2), 0);
  check('実働時間: 不正な時刻はnull', computeWorkedHours_('あ', '10:00', 0), null);
  check('推定収入: 8h × 1226円', computeEstimatedAmount_(8, 1226), 9808);
  check('推定収入: 端数は四捨五入', computeEstimatedAmount_(7.5, 1015), 7613);

  /* --- 給与所得控除 --- */
  check('給与所得控除: 収入0', computeSalaryDeduction_(0), 0);
  check('給与所得控除: 収入40万（収入が上限）', computeSalaryDeduction_(400000), 400000);
  check('給与所得控除: 収入123万', computeSalaryDeduction_(1230000), 650000);
  check('給与所得控除: 収入200万', computeSalaryDeduction_(2000000), 680000);

  /* --- 年間集計 --- */
  var calRows = [
    { date: '2026-01-10', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 },
    { date: '2026-08-01', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 },
    { date: '2025-12-31', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 9808 }
  ];
  var manualRows = [
    { source_name: '業務委託A', income_category: '事業所得', period: '2026-03〜2026-05', amount: 300000, expenses: 50000 },
    { source_name: '前職', income_category: '給与所得', period: '2026-02', amount: 100000, expenses: 0 },
    { source_name: '去年分', income_category: '事業所得', period: '2025-03', amount: 999999, expenses: 0 }
  ];
  var annual = aggregateAnnual_(calRows, manualRows, 2026);
  check('年間: カレンダー由来の給与収入', annual.calendarRevenue, 19616);
  check('年間: 給与収入合計', annual.salaryRevenue, 119616);
  check('年間: 事業収入', annual.businessRevenue, 300000);
  check('年間: 収入合計（壁の判定用）', annual.totalRevenue, 419616);
  check('年間: 給与所得（控除後・0未満にしない）', annual.salaryIncome, 0);
  check('年間: 事業所得（収入−経費）', annual.businessIncome, 250000);
  check('年間: 合計所得金額', annual.totalIncome, 250000);

  var badManual = aggregateAnnual_([], [{ source_name: 'X', income_category: '事業所得', period: '春ごろ', amount: 1 }], 2026);
  check('年間: periodに年が無い行は除外して警告', [badManual.totalRevenue, badManual.warnings.length], [0, 1]);

  /* --- 壁 --- */
  var wallRows = [
    { name: '123万円', amount: 1230000, applicable_year: 2026, last_updated: '2026-08-22', note: '' },
    { name: '130万円', amount: 1300000, applicable_year: 2026, last_updated: '2026-08-22', note: '' },
    { name: '旧年度の壁', amount: 1030000, applicable_year: 2025, last_updated: '2025-01-01', note: '' }
  ];
  var walls = evaluateWalls_(wallRows, 1000000, 2026);
  check('壁: 対象年のものだけ評価', walls.length, 2);
  check('壁: 123万円までの残り', walls[0].remaining, 230000);
  check('壁: 90%未満は正常', walls[0].status, '正常');
  check('壁: 90%以上は注意', evaluateWalls_(wallRows, 1150000, 2026)[0].status, '注意');
  check('壁: 超過は警告', evaluateWalls_(wallRows, 1300000, 2026)[0].status, '警告');
  check('壁: 超過分はマイナス表示', evaluateWalls_(wallRows, 1300000, 2026)[0].remaining, -70000);

  /* --- 月間労働時間 --- */
  var hourRows = [
    { date: '2026-08-01', company_name: 'Kakedas', worked_hours: 90, estimated_amount: 0 },
    { date: '2026-08-02', company_name: 'Kakedas', worked_hours: 6, estimated_amount: 0 },
    { date: '2026-08-03', company_name: 'バイトレ', worked_hours: 10, estimated_amount: 0 },
    { date: '2026-07-31', company_name: 'Kakedas', worked_hours: 100, estimated_amount: 0 }
  ];
  var limitRows = [{ company_name: 'Kakedas', monthly_hour_limit: 120, confirmed: false }];
  var hours = aggregateMonthlyHours_(hourRows, limitRows, '2026-08');
  check('時間: 会社ごとに当月分のみ集計', hours.length, 2);
  check('時間: Kakedasの当月実働', hours[0].hours, 96);
  check('時間: 80%到達で注意', hours[0].status, '注意');
  check('時間: 未登録の会社は暫定120hを適用', [hours[1].companyName, hours[1].limit, hours[1].status], ['バイトレ', 120, '正常']);
  var over = aggregateMonthlyHours_(
    [{ date: '2026-08-01', company_name: 'Kakedas', worked_hours: 120, estimated_amount: 0 }],
    limitRows,
    '2026-08'
  );
  check('時間: 100%到達で警告', over[0].status, '警告');

  /* --- 週の上限（正社員の週所定労働時間の4分の3） --- */
  check('週の開始日: 水曜日から月曜日', weekStartOf_('2026-08-19'), '2026-08-17');
  check('週の開始日: 月曜日はその日', weekStartOf_('2026-08-17'), '2026-08-17');
  check('週の開始日: 日曜日は同じ週の月曜', weekStartOf_('2026-08-23'), '2026-08-17');

  var weeklyLimitRows = [
    { company_name: 'リージェンシー', monthly_hour_limit: 130, weekly_hour_limit: 30, consecutive_months: 1, confirmed: true },
    { company_name: 'Kakedas', monthly_hour_limit: 120, weekly_hour_limit: 0, consecutive_months: 1, confirmed: false }
  ];
  var weeklyRows = [
    { date: '2026-08-17', company_name: 'リージェンシー', worked_hours: 8, estimated_amount: 0 },
    { date: '2026-08-19', company_name: 'リージェンシー', worked_hours: 8, estimated_amount: 0 },
    { date: '2026-08-21', company_name: 'リージェンシー', worked_hours: 9, estimated_amount: 0 },
    { date: '2026-08-21', company_name: 'Kakedas', worked_hours: 8, estimated_amount: 0 }
  ];
  var weekly = aggregateWeeklyHours_(weeklyRows, weeklyLimitRows, new Date(2026, 7, 21, 12, 0), 2);
  check('週集計: 週上限のある勤務先だけ', weekly.map(function (w) { return w.companyName; }).join(','), 'リージェンシー,リージェンシー');
  var thisWeek = weekly.filter(function (w) { return w.isCurrentWeek; })[0];
  check('週集計: 今週の実働', [thisWeek.weekStart, thisWeek.hours, thisWeek.limit], ['2026-08-17', 25, 30]);
  check('週集計: 80%超で注意', thisWeek.status, '注意');
  check('週集計: 残り時間', thisWeek.remainingHours, 5);
  var overWeek = aggregateWeeklyHours_(
    weeklyRows.concat([{ date: '2026-08-22', company_name: 'リージェンシー', worked_hours: 6, estimated_amount: 0 }]),
    weeklyLimitRows,
    new Date(2026, 7, 21, 12, 0),
    1
  );
  check('週集計: 上限到達で警告', [overWeek[0].hours, overWeek[0].status], [31, '警告']);
  check('週集計: 週上限が無ければ対象外', aggregateWeeklyHours_(weeklyRows, [weeklyLimitRows[1]], new Date(2026, 7, 21), 2).length, 0);

  /* --- 連続月（月◯時間以上が◯ヶ月連続） --- */
  var beatLimits = [
    { company_name: 'ビート', monthly_hour_limit: 80, weekly_hour_limit: 0, consecutive_months: 2, confirmed: true },
    { company_name: 'Kakedas', monthly_hour_limit: 120, weekly_hour_limit: 0, consecutive_months: 1, confirmed: false }
  ];
  var quiet = evaluateConsecutiveMonths_(
    [{ date: '2026-08-01', company_name: 'ビート', worked_hours: 40, estimated_amount: 0 }],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 対象は連続月数2以上の勤務先だけ', quiet.length, 1);
  check('連続月: どちらも下回れば正常', quiet[0].status, '正常');

  var warned = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 40, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 先月だけ超えていたら注意', warned[0].status, '注意');
  check('連続月: 今月あと何時間で連続になるか示す', warned[0].message.indexOf('あと 40時間で2ヶ月連続') > 0, true);

  var alerted = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 82, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23)
  );
  check('連続月: 2ヶ月連続で超えたら警告', alerted[0].status, '警告');
  check('連続月: 実績を並べて示す', alerted[0].message.indexOf('2026-07 85h / 2026-08 82h') > 0, true);

  var projected = evaluateConsecutiveMonths_(
    [
      { date: '2026-07-01', company_name: 'ビート', worked_hours: 85, estimated_amount: 0 },
      { date: '2026-08-01', company_name: 'ビート', worked_hours: 60, estimated_amount: 0 }
    ],
    beatLimits,
    new Date(2026, 7, 23),
    { 'ビート\t2026-08': 25 }
  );
  check('連続月: 予定を足した見込みでも判定できる', projected[0].status, '警告');

  /* --- 月次の答え合わせ --- */
  check('答え合わせ: 誤差が小さければOK', evaluateReconciliation_(100000, 101000).status, 'OK');
  check('答え合わせ: 率も額も超えたら要確認', evaluateReconciliation_(100000, 120000).status, '要確認');
  check('答え合わせ: 少額なら率が大きくてもOK', evaluateReconciliation_(10000, 12000).status, 'OK');

  /* --- 変換ユーティリティ --- */
  check('数値変換: カンマと円', toNumber_('1,226円'), 1226);
  check('数値変換: 空文字', toNumber_(''), 0);
  check('真偽変換', [toBool_(true), toBool_('TRUE'), toBool_('')], [true, true, false]);
  check('日付文字列の正規化', toDateString_('2026/8/1'), '2026-08-01');
  check('年月の取り出し', yearMonthOfDateString_('2026-08-01'), '2026-08');
  check('日付入力: 正しい日付', formatDate_(parseDateInput_('2026-08-20')), '2026-08-20');
  check('日付入力: 存在しない日付は拒否', parseDateInput_('2026/8/32'), null);
  check('日付入力: 形式違いは拒否', parseDateInput_('8月20日'), null);

  /* --- ロケール・タイムゾーン --- */
  check('時刻セル: 文字列はそのまま', toTimeString_('9:00'), '09:00');
  check('日付セル: 文字列はそのまま', toDateString_('2026/8/1'), '2026-08-01');

  var summary = failed === 0 ? 'セルフテスト: 全' + details.length + '件成功' : 'セルフテスト: ' + failed + '件失敗 / 全' + details.length + '件';
  return { summary: summary, details: details, failed: failed };
}
