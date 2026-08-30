/**
 * 給与サイクル（締め日と支給日）
 *
 * 会社によって「いつまでに働いた分が、いつ振り込まれるか」が違う。
 * 年収の壁の判定は、税法上「支給日」が属する年で数えるため
 * （所得税基本通達36-9）、勤務日ではなく支給日で集計する。
 *
 * 例: 21日〆・翌月10日払いの会社で 3/21〜4/20 に働いた分は、5/10 に支給される。
 *     5/10 が日曜なら、前倒しで 5/8（金）になる。
 */

/** 支給日が休日にあたったときの動かし方 */
var PAY_SHIFT_EARLIER = '前倒し';
var PAY_SHIFT_LATER = '後ろ倒し';
var PAY_SHIFT_NONE = 'そのまま';

/**
 * 会社の給与サイクル設定を読む。
 * シートに無い勤務先は CONFIG.payCycle.fallback を暫定値として使う。
 */
function readPayCycles_() {
  var map = {};
  readTable_(SHEETS.PAYCYCLE).rows.forEach(function (r) {
    var name = String(r.company_name || '').trim();
    if (!name) return;
    map[name] = {
      companyName: name,
      cutoffDay: toNumber_(r.cutoff_day) || CONFIG.payCycle.fallback.cutoffDay,
      // 0（当月払い）も正しい値なので、空欄のときだけ既定値にする
      payMonthOffset: isBlank_(r.pay_month_offset)
        ? CONFIG.payCycle.fallback.payMonthOffset
        : toNumber_(r.pay_month_offset),
      payDay: toNumber_(r.pay_day) || CONFIG.payCycle.fallback.payDay,
      shiftRule: String(r.shift_rule || CONFIG.payCycle.fallback.shiftRule).trim(),
      shiftOnHoliday: toBool_(r.shift_on_holiday),
      confirmed: toBool_(r.confirmed),
      note: String(r.note || '')
    };
  });
  return map;
}

/** 勤務先の給与サイクル。登録が無ければ暫定値を返す */
function payCycleFor_(cycles, companyName) {
  var name = String(companyName || '').trim();
  if (cycles && cycles[name]) return cycles[name];
  var fb = CONFIG.payCycle.fallback;
  return {
    companyName: name,
    cutoffDay: fb.cutoffDay,
    payMonthOffset: fb.payMonthOffset,
    payDay: fb.payDay,
    shiftRule: fb.shiftRule,
    shiftOnHoliday: !!fb.shiftOnHoliday,
    confirmed: false,
    note: '未登録のため暫定値'
  };
}

/** その月の日数 */
function daysInMonth_(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

/** 年・月・日から 'yyyy-MM-dd'。日がその月に無ければ月末に丸める（31日〆＝月末など） */
function clampedDateString_(year, month1to12, day) {
  var total = year * 12 + (month1to12 - 1);
  var y = Math.floor(total / 12);
  var m = (total % 12) + 1;
  var last = daysInMonth_(y, m);
  var d = Math.min(Math.max(1, Math.round(day)), last);
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

/**
 * 勤務日が属する締め日を返す。
 * cutoffDay が月末を超える指定（31など）なら、その月の月末が締め日になる。
 */
function cutoffDateFor_(workDate, cutoffDay) {
  var m = String(workDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var year = Number(m[1]);
  var month = Number(m[2]);
  var day = Number(m[3]);
  var cutoffThisMonth = Math.min(cutoffDay, daysInMonth_(year, month));
  // 締め日を過ぎていれば、次の締め（翌月）の期間に入る
  var offset = day <= cutoffThisMonth ? 0 : 1;
  return clampedDateString_(year, month + offset, cutoffDay);
}

/** 締め日から、休日調整をする前の支給日を返す */
function scheduledPayDate_(cutoffDate, cycle) {
  var m = String(cutoffDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return clampedDateString_(Number(m[1]), Number(m[2]) + cycle.payMonthOffset, cycle.payDay);
}

/** 土日か */
function isWeekend_(dateStr) {
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  var day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getDay();
  return day === 0 || day === 6;
}

/**
 * 支給日が休日にあたっていたら、前後の営業日にずらす。
 * holidays は { 'yyyy-MM-dd': true } の形。空でも土日の判定はできる。
 */
function adjustPayDate_(dateStr, shiftRule, shiftOnHoliday, holidays) {
  if (shiftRule === PAY_SHIFT_NONE) return dateStr;
  var step = shiftRule === PAY_SHIFT_LATER ? 1 : -1;
  var current = dateStr;
  // 連休が続いても抜けられるように、上限を決めて動かす
  for (var i = 0; i < 30; i++) {
    var closed = isWeekend_(current) || (shiftOnHoliday && holidays && holidays[current]);
    if (!closed) return current;
    current = addDays_(current, step);
  }
  return dateStr;
}

/**
 * 勤務日から支給日を求める。
 * 戻り値: { cutoffDate, scheduledDate, payDate, periodFrom, periodTo, confirmed, cycle }
 */
function resolvePayment_(workDate, cycle, holidays) {
  var cutoffDate = cutoffDateFor_(workDate, cycle.cutoffDay);
  if (!cutoffDate) return null;
  var scheduled = scheduledPayDate_(cutoffDate, cycle);
  var payDate = adjustPayDate_(scheduled, cycle.shiftRule, cycle.shiftOnHoliday, holidays);
  // 締め期間は「前回の締め日の翌日」から「今回の締め日」まで
  var cut = cutoffDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var periodFrom = addDays_(clampedDateString_(Number(cut[1]), Number(cut[2]) - 1, cycle.cutoffDay), 1);
  return {
    cutoffDate: cutoffDate,
    periodFrom: periodFrom,
    periodTo: cutoffDate,
    scheduledDate: scheduled,
    payDate: payDate,
    moved: scheduled !== payDate,
    confirmed: !!cycle.confirmed,
    companyName: cycle.companyName
  };
}

/** 勤務先ごとの支給日を一度に引けるようにした関数を返す（毎回シートを読まないため） */
function makePaymentResolver_(holidays) {
  var cycles = readPayCycles_();
  var cache = {};
  return function (companyName, workDate) {
    var key = companyName + '\t' + workDate;
    if (cache[key] === undefined) {
      cache[key] = resolvePayment_(workDate, payCycleFor_(cycles, companyName), holidays);
    }
    return cache[key];
  };
}

/**
 * 勤務明細を支給日ごとにまとめる。
 * 「この日にいくら振り込まれる（振り込まれた）か」を出すためのもの。
 * 戻り値は支給日の古い順。
 */
function aggregatePayments_(calendarRows, resolvePayment, today, targetYear) {
  var todayStr = formatDate_(today);
  var groups = {};

  calendarRows.forEach(function (r) {
    var workDate = toDateString_(r.date);
    var company = String(r.company_name || '').trim();
    var payment = resolvePayment(company, workDate);
    if (!payment || !payment.payDate) return;
    if (targetYear && yearOfDateString_(payment.payDate) !== targetYear) return;

    var key = payment.payDate + '\t' + company;
    if (!groups[key]) {
      groups[key] = {
        payDate: payment.payDate,
        scheduledDate: payment.scheduledDate,
        moved: payment.moved,
        companyName: company,
        periodFrom: payment.periodFrom,
        periodTo: payment.periodTo,
        confirmed: payment.confirmed,
        days: 0,
        hours: 0,
        allowance: 0,
        amount: 0
      };
    }
    var g = groups[key];
    g.days += 1;
    g.hours += toNumber_(r.worked_hours);
    g.allowance += toNumber_(r.allowance);
    g.amount += toNumber_(r.estimated_amount);
  });

  return Object.keys(groups)
    .sort()
    .map(function (key) {
      var g = groups[key];
      g.hours = round2_(g.hours);
      g.isPaid = g.payDate <= todayStr;
      return g;
    });
}

/** 支給日ごとの合計（同じ日に複数社から振り込まれる場合をまとめる） */
function groupPaymentsByDate_(payments) {
  var byDate = {};
  var order = [];
  payments.forEach(function (p) {
    if (!byDate[p.payDate]) {
      byDate[p.payDate] = { payDate: p.payDate, isPaid: p.isPaid, amount: 0, hours: 0, companies: [] };
      order.push(p.payDate);
    }
    var d = byDate[p.payDate];
    d.amount += p.amount;
    d.hours = round2_(d.hours + p.hours);
    d.companies.push(p);
  });
  return order.sort().map(function (date) {
    return byDate[date];
  });
}
