/**
 * カレンダー予定タイトルの解析
 *
 * 想定フォーマット:
 *   [会社名] 開始時刻-終了時刻 休憩Xh 時給Y円
 *   例) [Kakedas] 09:00-18:00 休憩1h 時給1226円
 *   例) [バイトレ] 13:00-17:00 休憩なし 時給1700円
 *
 * ・会社名は [ ] で囲む（勤務予定の目印。無い予定は勤務以外とみなして無視する）
 * ・休憩が無い場合は「休憩なし」と明記する
 * ・時給は末尾に「円」付き
 */

/** 全角→半角などの表記ゆれを吸収する */
function normalizeTitle_(rawTitle) {
  var s = String(rawTitle == null ? '' : rawTitle);
  if (s.normalize) s = s.normalize('NFKC');
  return s.replace(/[　\s]+/g, ' ').trim();
}

/**
 * タイトルを解析する。
 * 戻り値: {
 *   ok, kind: 'work'|'skip'|'error', reason, warnings[],
 *   companyName, startTime, endTime, hasTimeRange, breakHours, hourlyWage, normalizedTitle
 * }
 */
function parseWorkEventTitle_(rawTitle) {
  var title = normalizeTitle_(rawTitle);
  var res = {
    ok: false,
    kind: 'skip',
    reason: '',
    warnings: [],
    companyName: '',
    startTime: '',
    endTime: '',
    hasTimeRange: false,
    breakHours: 0,
    hourlyWage: 0,
    allowance: 0,
    hasFixedAmount: false,
    fixedAmount: 0,
    normalizedTitle: title
  };

  var company = title.match(/[[［]\s*([^\]］]+?)\s*[\]］]/);
  if (!company) {
    res.reason = '会社名の [ ] が無いため勤務予定として扱いません';
    return res;
  }
  res.companyName = company[1];
  // [ ] がある＝勤務予定のつもり。ここから先の不備はフォーマット誤りとして報告する
  res.kind = 'error';

  // 区切り文字は各種ダッシュ・波ダッシュ・全角マイナスに対応する
  var range = title.match(
    /(\d{1,2}:\d{2})\s*(?:[-\u2010-\u2015\u2212\uFF0D~\u301C\u3030\uFF5E\u30FC]|to)\s*(\d{1,2}:\d{2})/i
  );
  if (range) {
    res.startTime = toTimeString_(range[1]);
    res.endTime = toTimeString_(range[2]);
    res.hasTimeRange = true;
    if (hhmmToMinutes_(res.startTime) === null || hhmmToMinutes_(res.endTime) === null) {
      res.reason = '時刻が不正です: ' + range[0];
      return res;
    }
  }

  var brk = parseBreakHours_(title);
  if (!brk.found) {
    res.warnings.push('休憩の記載がありません（休憩0hとして計算しました）。「休憩なし」または「休憩1h」と書いてください');
  }
  res.breakHours = brk.hours;

  var wage = title.match(/時給\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円/);
  if (!wage) {
    var wageNoYen = title.match(/時給\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    if (!wageNoYen) {
      res.reason = '時給の記載が見つかりません（例: 時給1226円）';
      return res;
    }
    wage = wageNoYen;
    res.warnings.push('時給に「円」がありません（例: 時給1226円）');
  }
  res.hourlyWage = toNumber_(wage[1]);
  if (res.hourlyWage <= 0) {
    res.reason = '時給が0円以下です';
    return res;
  }

  res.allowance = parseAllowance_(title);

  var fixed = parseFixedAmount_(title);
  if (fixed.found) {
    res.hasFixedAmount = true;
    res.fixedAmount = fixed.amount;
    if (res.allowance > 0) {
      res.warnings.push(
        '支給額を書いたので、その日の金額は支給額そのものにしました（手当は足していません）。' +
          '手当も受け取るなら、支給額に足した金額を書いてください'
      );
      res.allowance = 0;
    }
  }

  res.ok = true;
  res.kind = 'work';
  res.reason = '';
  return res;
}

/**
 * 手当（時給とは別に、その勤務1回につき出る固定額）を読み取る。
 *
 * 単発バイトでは就業先ごとに交通費・食事補助などが出るため、時給とは
 * 別建てで合算できるようにしている。複数書いてあれば全部足す。
 *
 * 対応: 手当1000円 / 交通費500円 / 手当+1000円 / 食事手当500円 など
 * 「手当なし」と書いた場合は0。
 */
function parseAllowance_(title) {
  if (/(?:手当|交通費)\s*(?:なし|ナシ|無し)/.test(title)) return 0;

  var total = 0;
  // 「〇〇手当」「交通費」「日当」に続く金額を全部拾う
  var pattern = /(?:[^\s\d]{0,4}手当|交通費|日当)\s*\+?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円?/g;
  var match;
  while ((match = pattern.exec(title)) !== null) {
    total += toNumber_(match[1]);
  }
  return total;
}

/**
 * その日の支給額（時給×時間の計算を上書きする、確定した金額）を読み取る。
 *
 * 残業がついた・特別手当が出た・端数の扱いが会社独自、といった理由で
 * 時給×時間と実際の支給額がずれる日のためのもの。書いてあればそれが優先される。
 *
 * 対応: 支給18500円 / 支給額18,500円 / 給与18500円 / 合計18500円
 */
function parseFixedAmount_(title) {
  var match = title.match(/(?:支給額|支給|給与|合計)\s*\+?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*円?/);
  if (!match) return { found: false, amount: 0 };
  var amount = toNumber_(match[1]);
  if (amount <= 0) return { found: false, amount: 0 };
  return { found: true, amount: Math.round(amount) };
}

/**
 * 休憩時間の表記を時間(小数)に変換する。
 * 対応: 休憩なし / 休憩無し / 休憩1h / 休憩1.5h / 休憩1時間 / 休憩1時間30分 / 休憩90分
 */
function parseBreakHours_(title) {
  if (/休憩\s*(?:なし|ナシ|無し|0\s*(?:h|時間|分)?)(?![0-9.])/i.test(title)) {
    return { found: true, hours: 0 };
  }
  var hm = title.match(/休憩\s*(\d+(?:\.\d+)?)\s*(?:h|時間)\s*(?:(\d+)\s*(?:m|分))?/i);
  if (hm) {
    var hours = Number(hm[1]) + (hm[2] ? Number(hm[2]) / 60 : 0);
    return { found: true, hours: hours };
  }
  var mm = title.match(/休憩\s*(\d+)\s*(?:m|min|分)/i);
  if (mm) return { found: true, hours: Number(mm[1]) / 60 };
  return { found: false, hours: 0 };
}
