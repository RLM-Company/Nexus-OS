// Spreadsheet applications may strip whitespace and invisible prefixes before
// evaluating a formula. Keep the original value as text in exported CSV cells.
export function safeSpreadsheetCell(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u0000-\u001f]*[=+\-@＝＋－＠]/u.test(
    value
  )
    ? "'" + value
    : value;
}

export function csvField(value: string): string {
  const safe = safeSpreadsheetCell(value);
  return /[,"\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
