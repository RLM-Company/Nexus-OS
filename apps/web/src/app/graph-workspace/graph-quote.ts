/** Textareas normalize line endings; return the matching original source bytes, never a reworded quote. */
export function resolveGraphQuote(source: string, draft: string): string | null {
  if (!draft.trim() || draft.length > 1000 || source.length > 1000) return null;
  if (source.includes(draft)) return draft;
  let normalized = "";
  const offsets = [0];
  for (let i = 0; i < source.length;) {
    if (source[i] === "\r") {
      normalized += "\n";
      i += source[i + 1] === "\n" ? 2 : 1;
    } else {
      normalized += source[i];
      i++;
    }
    offsets.push(i);
  }
  const query = draft.replace(/\r\n?/gu, "\n"),
    position = normalized.indexOf(query);
  return position < 0 ? null : source.slice(offsets[position], offsets[position + query.length]);
}
