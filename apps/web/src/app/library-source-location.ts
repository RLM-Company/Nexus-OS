export type SourceLocation = {
  page: number | null;
  line_start: number;
  line_end: number;
  citation?: string;
  content?: string;
};
/** UTF-16 offsets in the original page, including LF, CRLF and legacy CR lines. */
export function sourceLineRange(text: string, first: number, last: number) {
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first)
    return null;
  let line = 1,
    start = 0;
  for (const newline of text.matchAll(/\r\n|\r|\n/g)) {
    const end = newline.index + newline[0].length;
    if (line === last) return { start, end };
    if (line < first) start = end;
    line++;
  }
  return line === last && line >= first ? { start, end: text.length } : null;
}
export const PREVIEW_PART_SIZE = 20_000;
export function previewPart(text: string, part: number) {
  const count = Math.max(1, Math.ceil(text.length / PREVIEW_PART_SIZE));
  const index = Math.max(0, Math.min(count - 1, part));
  const boundary = (offset: number) =>
    offset > 0 &&
    /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[offset] ?? "")
      ? offset - 1
      : offset;
  return {
    index,
    count,
    start: boundary(index * PREVIEW_PART_SIZE),
    end: boundary(Math.min(text.length, (index + 1) * PREVIEW_PART_SIZE))
  };
}
