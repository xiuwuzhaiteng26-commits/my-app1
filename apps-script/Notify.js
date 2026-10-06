/**
 * 通知
 *
 * 既定は 'sheet'（サマリーシートと実行ログの更新のみ、外部送信なし）。
 * CONFIG.notify.channel を 'email' / 'webhook' に変えると毎日の実行結果を送る。
 */

function notify_(snapshot) {
  var body = buildNotificationText_(snapshot);
  var subject = '[年収の壁] ' + snapshot.generatedAt.slice(0, 10) + ' ' + snapshot.level;

  writeLog_('daily', snapshot.level, body.split('\n').slice(0, 3).join(' / '));

  var channel = CONFIG.notify.channel;
  var isAlert = snapshot.level !== '正常';
  if (channel === 'sheet' && !(CONFIG.notify.alwaysNotifyOnAlert && isAlert)) {
    return { channel: 'sheet', sent: false };
  }

  try {
    if (channel === 'webhook' && CONFIG.notify.webhookUrl) {
      postWebhook_(subject + '\n' + body);
      return { channel: 'webhook', sent: true };
    }
    var to = CONFIG.notify.emailTo || Session.getEffectiveUser().getEmail();
    if (!to) return { channel: channel, sent: false };
    MailApp.sendEmail(to, subject, body);
    return { channel: 'email', sent: true };
  } catch (e) {
    writeLog_('notify', '警告', '通知の送信に失敗しました: ' + e.message);
    return { channel: channel, sent: false, error: e.message };
  }
}

function postWebhook_(text) {
  var payload;
  if (CONFIG.notify.webhookFormat === 'discord') payload = { content: text };
  else if (CONFIG.notify.webhookFormat === 'json') payload = { message: text };
  else payload = { text: text };

  UrlFetchApp.fetch(CONFIG.notify.webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
