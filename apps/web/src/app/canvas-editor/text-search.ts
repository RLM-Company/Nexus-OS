export type TextMatch = { start: number; end: number };
export const MAX_SEARCH_MATCHES = 10_000;
/** Literal Unicode search: regex syntax in the query is always treated as text. */
export function searchText(text: string, query: string, caseSensitive = false) {
  if (!query) return { matches: [] as TextMatch[], capped: false };
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    caseSensitive ? "gu" : "giu"
  );
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(expression)) {
    if (matches.length === MAX_SEARCH_MATCHES) return { matches, capped: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, capped: false };
}
/** Replacement is literal too: $&, $1 and backslashes never interpolate source text. */
export function replaceMatches(text: string, matches: readonly TextMatch[], replacement: string) {
  const parts: string[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start < at || match.end < match.start || match.end > text.length)
      throw Error("INVALID_TEXT_MATCH");
    parts.push(text.slice(at, match.start), replacement);
    at = match.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}
