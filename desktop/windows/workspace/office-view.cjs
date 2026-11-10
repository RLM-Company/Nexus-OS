"use strict";
// Pages contain complete cells or explicitly marked Unicode-safe text excerpts.
// Cursor positions have meaning only with the exact source version.
const invalid = () => {
  throw Error("WORKSPACE_OFFICE_CURSOR_INVALID");
};
function pageOfficeView(base, items, cursor = { target_offset: 0, content_offset: 0 }) {
  if (
    !cursor ||
    Array.isArray(cursor) ||
    Object.keys(cursor).length !== 2 ||
    !Object.hasOwn(cursor, "target_offset") ||
    !Object.hasOwn(cursor, "content_offset") ||
    !Number.isSafeInteger(cursor.target_offset) ||
    !Number.isSafeInteger(cursor.content_offset) ||
    cursor.target_offset < 0 ||
    cursor.target_offset > 200000 ||
    cursor.content_offset < 0 ||
    cursor.content_offset > 256000 ||
    (items.length > 0
      ? cursor.target_offset >= items.length
      : cursor.target_offset !== 0 || cursor.content_offset !== 0)
  )
    invalid();
  const targets = [];
  const result = (next) => ({
    ...base,
    cursor,
    total_targets: items.length,
    targets,
    next_cursor: next,
    targets_excerpt_only: cursor.target_offset > 0 || cursor.content_offset > 0 || next !== null
  });
  if (items.length === 0) {
    const empty = result(null);
    if (Buffer.byteLength(JSON.stringify(empty)) > 10000)
      throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
    return empty;
  }
  const fits = (item, next) =>
    Buffer.byteLength(JSON.stringify({ ...result(next), targets: [...targets, item] })) <= 10000;
  const nextTarget = (i) =>
    i + 1 < items.length ? { target_offset: i + 1, content_offset: 0 } : null;
  let index = cursor.target_offset,
    offset = cursor.content_offset;
  while (index < items.length && targets.length < 100) {
    const item = items.get(index);
    let full, best, next;
    if (item.cells) {
      if (offset > item.cells.length || (offset === item.cells.length && offset !== 0)) invalid();
      const count = Math.min(100, item.cells.length - offset);
      const candidate = (size) => ({
        ...item,
        cells: item.cells.slice(offset, offset + size),
        cells_offset: offset,
        cells_excerpt_only: offset > 0 || offset + size < item.cells.length
      });
      const continuation = (size) =>
        offset + size < item.cells.length
          ? { target_offset: index, content_offset: offset + size }
          : nextTarget(index);
      let low = 0,
        high = count;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(candidate(middle), continuation(middle))) low = middle;
        else high = middle - 1;
      }
      if (low === 0 && item.cells.length) {
        if (!targets.length) throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
        return result({ target_offset: index, content_offset: offset });
      }
      full = candidate(low);
      next = continuation(low);
      best = low;
    } else {
      const text = item.text;
      if (
        offset > text.length ||
        (offset === text.length && offset !== 0) ||
        (offset > 0 &&
          /[\uDC00-\uDFFF]/.test(text[offset] || "") &&
          /[\uD800-\uDBFF]/.test(text[offset - 1] || ""))
      )
        invalid();
      const safe = (size) =>
        size > 0 &&
        /[\uD800-\uDBFF]/.test(text[offset + size - 1] || "") &&
        /[\uDC00-\uDFFF]/.test(text[offset + size] || "")
          ? size - 1
          : size;
      const candidate = (size) => ({
        ...item,
        text: text.slice(offset, offset + size),
        text_offset: offset,
        total_text_utf16: text.length,
        text_excerpt_only: offset > 0 || offset + size < text.length
      });
      const continuation = (size) =>
        offset + size < text.length
          ? { target_offset: index, content_offset: offset + size }
          : nextTarget(index);
      let low = 0,
        high = text.length - offset;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2),
          size = safe(middle);
        if (fits(candidate(size), continuation(size))) low = middle;
        else high = middle - 1;
      }
      best = safe(low);
      if (best === 0 && text.length) {
        if (!targets.length) throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
        return result({ target_offset: index, content_offset: offset });
      }
      full = candidate(best);
      next = continuation(best);
    }
    if (!fits(full, next)) {
      if (!targets.length) throw Error("WORKSPACE_OFFICE_VIEW_LIMIT");
      return result({ target_offset: index, content_offset: offset });
    }
    targets.push(full);
    if (!next || next.target_offset === index) return result(next);
    index = next.target_offset;
    offset = 0;
  }
  return result(index < items.length ? { target_offset: index, content_offset: offset } : null);
}
module.exports = { pageOfficeView };
