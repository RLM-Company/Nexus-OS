import { createHash } from "node:crypto";
export type KnowledgeKind = "canvas" | "work" | "memory" | "document";
export type KnowledgeReference = {
  kind: KnowledgeKind;
  id: string;
  version: number | null;
  sha256: string;
  chunk_id?: number;
};
export type KnowledgeSource = {
  reference: KnowledgeReference;
  title: string;
  text: string;
  page?: number | null;
  line_start?: number;
};
export type KnowledgeHit = {
  reference: KnowledgeReference & { start: number; end: number; excerpt_sha256: string };
  title: string;
  excerpt: string;
  score: number;
  matched_terms: string[];
  match_in: Array<"title" | "content">;
  page: number | null;
  line_start: number;
  line_end: number;
};
export class KnowledgeSearchError extends Error {}
export const knowledgeHash = (value: string) => createHash("sha256").update(value).digest("hex");
const fold = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
export function knowledgeTerms(query: string): string[] {
  if (typeof query !== "string" || query.length > 200)
    throw new KnowledgeSearchError("KNOWLEDGE_QUERY_INVALID");
  const terms = [
    ...new Set((fold(query).match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => t.length >= 2))
  ];
  if (!terms.length || terms.length > 16 || terms.some((t) => t.length > 80))
    throw new KnowledgeSearchError("KNOWLEDGE_QUERY_INVALID");
  return terms;
}
const words = (value: string) => [...new Set(fold(value).match(/[\p{L}\p{N}_]+/gu) ?? [])];
const matched = (tokens: string[], terms: string[]) =>
  terms.filter((term) => tokens.some((token) => token.startsWith(term)));
const breaks = (value: string) => (value.match(/\r\n|\r|\n/g) ?? []).length;
const boundary = (text: string, index: number) => {
  const char = text.charCodeAt(index);
  return index > 0 &&
    ((char >= 0xdc00 && char <= 0xdfff) || (text[index] === "\n" && text[index - 1] === "\r"))
    ? index - 1
    : index;
};
/** Literal excerpts from bounded sources. Ranking is lexical, never a factual confidence score. */
export function searchKnowledgeSources(
  sources: readonly KnowledgeSource[],
  query: string,
  limit = 20
): KnowledgeHit[] {
  const terms = knowledgeTerms(query);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 30 ||
    sources.length > 2000 ||
    sources.reduce((n, s) => n + Buffer.byteLength(s.text), 0) > 8_000_000
  )
    throw new KnowledgeSearchError("KNOWLEDGE_INPUT_LIMIT");
  const candidates: KnowledgeHit[] = [];
  for (const source of sources) {
    const titleTerms = matched(words(source.title), terms);
    let start = 0,
      line = source.line_start ?? 1;
    while (start < source.text.length) {
      const end = boundary(source.text, Math.min(start + 1200, source.text.length));
      const excerpt = source.text.slice(start, end);
      const bodyTerms = matched(words(excerpt), terms);
      if (bodyTerms.length || (start === 0 && titleTerms.length)) {
        const matchedTerms = [...new Set([...bodyTerms, ...titleTerms])];
        candidates.push({
          reference: { ...source.reference, start, end, excerpt_sha256: knowledgeHash(excerpt) },
          title: source.title,
          excerpt,
          score:
            bodyTerms.length * 5 +
            (matchedTerms.length * matchedTerms.length * 8) / terms.length +
            (start === 0 ? titleTerms.length * 3 : 0),
          matched_terms: matchedTerms,
          match_in: [
            ...(titleTerms.length ? ["title" as const] : []),
            ...(bodyTerms.length ? ["content" as const] : [])
          ],
          page: source.page ?? null,
          line_start: line,
          line_end: line + breaks(excerpt) - (/(?:\r\n|\r|\n)$/.test(excerpt) ? 1 : 0)
        });
      }
      if (end === source.text.length) break;
      const next = boundary(source.text, end - 120);
      line += breaks(source.text.slice(start, next));
      start = next;
    }
  }
  const identity = (hit: KnowledgeHit) =>
    JSON.stringify([
      hit.reference.kind,
      hit.reference.id,
      hit.reference.version,
      hit.reference.chunk_id ?? null,
      hit.reference.start
    ]);
  candidates.sort(
    (a, b) =>
      b.score - a.score || (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0)
  );
  const result: KnowledgeHit[] = [],
    counts = new Map<string, number>();
  for (const hit of candidates) {
    const key = JSON.stringify([hit.reference.kind, hit.reference.id]);
    if ((counts.get(key) ?? 0) >= 2) continue;
    if (
      result.some(
        (previous) =>
          previous.reference.kind === hit.reference.kind &&
          previous.reference.id === hit.reference.id &&
          previous.reference.chunk_id === hit.reference.chunk_id &&
          previous.reference.start < hit.reference.end &&
          hit.reference.start < previous.reference.end
      )
    )
      continue;
    result.push(hit);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (result.length === limit) break;
  }
  return result;
}
