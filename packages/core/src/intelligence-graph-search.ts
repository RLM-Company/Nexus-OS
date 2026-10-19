/** Normalize only for comparison. Saved text, citations and portable bytes remain untouched. */
export const normalizeGraphSearchText = (text: string): string =>
  text.normalize("NFC").trim().toLocaleLowerCase("ru-RU");
export const graphSearchTokens = (text: string): string[] => [
  ...new Set(normalizeGraphSearchText(text).match(/[\p{L}\p{N}_-]+/gu) ?? [])
];
export const INTELLIGENCE_GRAPH_SEARCH_VERSION = "title-and-saved-text-v2";

export function compileGraphSearch(text: string) {
  return { text: normalizeGraphSearchText(text), tokens: graphSearchTokens(text) };
}

export function graphRecordScore(
  query: ReturnType<typeof compileGraphSearch>,
  record: { text: string; excerpt: string }
): number {
  if (!query.text || query.tokens.length === 0) return 0;
  const fieldScore = (value: string) => {
    const normalized = normalizeGraphSearchText(value),
      tokens = new Set(graphSearchTokens(normalized));
    const overlap = query.tokens.filter((t) => tokens.has(t)).length;
    return overlap + (normalized.includes(query.text) ? query.tokens.length * 2 : 0);
  };
  // Every title match outranks a body-only match; repeated words do not inflate either field.
  return fieldScore(record.text) * (3 * query.tokens.length + 1) + fieldScore(record.excerpt);
}
