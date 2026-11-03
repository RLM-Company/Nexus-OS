import type { ContextMemoryEvidence } from "@cosmora/contracts";
import { libraryTerms } from "./document-library.js";

type Evidence = ContextMemoryEvidence;
const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");

// A reference alone is insufficient: versions, roles and the original message hash
// must agree before one literal excerpt can cover another. Never deduplicate by
// normalized wording, which can collapse different numbers or independent sources.
const origin = (e: Evidence) =>
  JSON.stringify([
    e.reference,
    e.kind,
    e.memory_kind,
    e.version,
    e.title,
    e.source && [
      e.source.kind,
      e.source.message_id,
      e.source.chat_id,
      e.source.project_id,
      e.source.role,
      e.source.sha256,
      e.source.quote
    ]
  ]);
const compatible = (a: Evidence, b: Evidence) =>
  a.sequence === undefined || b.sequence === undefined || a.sequence === b.sequence;
const absorb = (container: Evidence, covered: Evidence): Evidence => ({
  ...container,
  ...(covered.priority ? { priority: true } : {}),
  ...(container.sequence === undefined && covered.sequence !== undefined
    ? { sequence: covered.sequence }
    : {}),
  ...(covered.retrieval_rank !== undefined
    ? {
        retrieval_rank: Math.min(
          container.retrieval_rank ?? Number.MAX_SAFE_INTEGER,
          covered.retrieval_rank
        )
      }
    : {})
});

/** Lossless runtime view only; stored facts, quotes and originals are unchanged. */
export function compactContextEvidence(items: readonly Evidence[]): Evidence[] {
  type Entry = { item: Evidence };
  const groups = new Map<string, Entry[]>();
  const selected: Entry[] = [];
  items.forEach((original) => {
    // An empty quote is already supported by history-compaction evidence. The
    // literal quote remains in text, with the same source link, role and hash.
    const item =
      original.source?.quote === original.text
        ? { ...original, source: { ...original.source, quote: "" } }
        : original;
    const key = origin(item);
    const group = groups.get(key) ?? [];
    const entry = { item };
    group.push(entry);
    groups.set(key, group);
    selected.push(entry);
  });
  const retained = new Set<Entry>();
  for (const group of groups.values()) {
    const containers: Entry[] = [];
    const exact = new Map<string, Entry[]>();
    // Longest first makes literal coverage independent of input ordering. Limit
    // containment comparisons for pathological groups; exact repeats still fold.
    for (const entry of [...group].sort((a, b) => b.item.text.length - a.item.text.length)) {
      const item = entry.item;
      const candidates = group.length <= 64 ? containers : (exact.get(item.text) ?? []);
      const index = candidates.findIndex(
        (other) =>
          compatible(other.item, item) &&
          (other.item.text === item.text ||
            (item.kind === "history" &&
              !!item.source &&
              (!item.priority || other.item.priority) &&
              other.item.text.includes(item.text)))
      );
      if (index < 0) {
        containers.push(entry);
        const matches = exact.get(item.text) ?? [];
        matches.push(entry);
        exact.set(item.text, matches);
        continue;
      }
      const previous = candidates[index]!;
      // Keep a single representative while carrying mandatory status/chronology.
      previous.item = absorb(previous.item, item);
    }
    for (const item of containers) retained.add(item);
  }
  return selected.filter((entry) => retained.has(entry)).map((entry) => entry.item);
}

/** Preserve trusted hybrid order through final fitting. Priority always wins. */
export function rankContextEvidence(items: readonly Evidence[], query?: string): Evidence[] {
  const terms = query
    ? [...new Set([...libraryTerms(query), ...(fold(query).match(/\p{N}+/gu) ?? [])])].slice(0, 32)
    : [];
  const tokens = (text: string) => new Set(fold(text).match(/[\p{L}\p{N}_]+/gu) ?? []);
  const overlap = (words: Set<string>) => terms.filter((term) => words.has(term)).length;
  return items
    .map((item, index) => ({
      item,
      index,
      required: Number(Boolean(item.priority || item.memory_kind === "constraint")),
      score: terms.length ? overlap(tokens(item.text)) * 4 + overlap(tokens(item.title)) : 0
    }))
    .sort(
      (a, b) =>
        b.required - a.required ||
        (a.item.retrieval_rank ?? Number.MAX_SAFE_INTEGER) -
          (b.item.retrieval_rank ?? Number.MAX_SAFE_INTEGER) ||
        b.score - a.score ||
        a.index - b.index
    )
    .map(({ item }) => item);
}
