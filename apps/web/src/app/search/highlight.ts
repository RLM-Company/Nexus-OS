export type HighlightPart = { text: string; matched: boolean };

/** Token-safe output. Render text with React, never dangerouslySetInnerHTML. */
export function splitHighlights(content: string, query: string): HighlightPart[] {
  const words = (query.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.toLocaleLowerCase("ru"));
  if (!words.length || !content) return [{ text: content, matched: false }];
  const output: HighlightPart[] = [];
  let cursor = 0;
  const lower = content.toLocaleLowerCase("ru");
  while (cursor < content.length) {
    let next = -1;
    let length = 0;
    for (const word of words) {
      const found = lower.indexOf(word, cursor);
      if (found >= 0 && (next < 0 || found < next || (found === next && word.length > length))) {
        next = found;
        length = word.length;
      }
    }
    if (next < 0) break;
    if (next > cursor) output.push({ text: content.slice(cursor, next), matched: false });
    output.push({ text: content.slice(next, next + length), matched: true });
    cursor = next + length;
  }
  if (cursor < content.length) output.push({ text: content.slice(cursor), matched: false });
  return output;
}
