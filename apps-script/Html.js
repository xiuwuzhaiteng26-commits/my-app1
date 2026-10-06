/**
 * HTML ファイルの読み込み
 *
 * 通常はプロジェクト内の .html ファイルを使うが、
 * 全部入りの1ファイル版（dist/all-in-one.gs）では HTML も同じファイルに
 * 埋め込まれるため、その場合は INLINE_HTML から読む。
 */
var INLINE_HTML = {};

function htmlTemplate_(name) {
  if (INLINE_HTML[name]) return HtmlService.createTemplate(INLINE_HTML[name]);
  return HtmlService.createTemplateFromFile(name);
}

function htmlOutput_(name) {
  if (INLINE_HTML[name]) return HtmlService.createHtmlOutput(INLINE_HTML[name]);
  return HtmlService.createHtmlOutputFromFile(name);
}
