"use strict";
const { ERROR_CODES, KosworkWorkspaceError } = require("./errors.cjs");

// Scan offsets without allocating an array for every line of a large file.
// Keep original CRLF/CR/LF inside the selected span; never paraphrase a source.
function selectTextRange(content, { startLine, endLine, maxBytes = 10000 } = {}) {
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine >= 120 ||
    endLine > 2097153 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 10000
  )
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_RANGE_INVALID,
      "Укажите от 1 до 120 строк, с нумерацией от 1."
    );
  let line = 1,
    start = startLine === 1 ? 0 : -1,
    end = -1,
    match;
  const breaks = /\r\n|\r|\n/g;
  while ((match = breaks.exec(content)) !== null) {
    if (line === endLine) end = match.index;
    line++;
    if (line === startLine) start = breaks.lastIndex;
  }
  if (start === -1)
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_RANGE_INVALID,
      "Начальная строка находится за концом файла.",
      { totalLines: line }
    );
  if (end === -1) end = content.length;
  const quote = content.slice(start, end);
  // Bound the actual serialized content, including escaped characters and UTF-8.
  // Oversized lines are rejected in full, not silently cut into fake quotations.
  if (Buffer.byteLength(JSON.stringify(quote), "utf8") > maxBytes)
    throw new KosworkWorkspaceError(
      ERROR_CODES.WORKSPACE_FILE_TOO_LARGE,
      "Выбранные строки превышают бюджет ответа. Запросите меньший диапазон."
    );
  const actualEnd = Math.min(endLine, line);
  return {
    content: quote,
    start_line: startLine,
    end_line: actualEnd,
    total_lines: line,
    next_start_line: actualEnd < line ? actualEnd + 1 : null,
    content_bytes: Buffer.byteLength(quote, "utf8"),
    excerpt_only: startLine !== 1 || actualEnd !== line
  };
}
module.exports = { selectTextRange };
