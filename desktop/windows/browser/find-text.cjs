"use strict";

// Adapted from Gemini's find-in-page-highlighter (reference snapshot 2a108cf3).
// Match against the original string: lowercasing can change UTF-16 offsets (İ).
function findText(text, action, metadata) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(escape(action.query), action.case_sensitive ? "gu" : "giu");
  expression.lastIndex = action.offset_utf16;
  const result = {
    ...metadata,
    query: action.query,
    case_sensitive: action.case_sensitive,
    offset_utf16: action.offset_utf16,
    matches: [],
    matches_truncated: false,
    next_offset: null,
    complete_scan_from_offset: true
  };
  for (let match; (match = expression.exec(text));) {
    const item = {
      start_utf16: match.index,
      end_utf16: match.index + match[0].length,
      quote: match[0]
    };
    const candidate = {
      ...result,
      matches: [...result.matches, item],
      matches_truncated: true,
      next_offset: item.end_utf16,
      complete_scan_from_offset: false
    };
    if (
      result.matches.length === 20 ||
      Buffer.byteLength(JSON.stringify(candidate), "utf8") > 10000
    ) {
      if (!result.matches.length) throw Error("BROWSER_TEXT_UNAVAILABLE");
      result.matches_truncated = true;
      result.next_offset = result.matches.at(-1).end_utf16;
      result.complete_scan_from_offset = false;
      break;
    }
    result.matches.push(item);
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 10000)
    throw Error("BROWSER_TEXT_UNAVAILABLE");
  return result;
}

module.exports = { findText };
