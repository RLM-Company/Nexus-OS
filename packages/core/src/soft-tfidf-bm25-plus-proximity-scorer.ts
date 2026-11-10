export interface RankedDocumentScore {
  docId: string;
  bm25PlusScore: number;
  proximityBoostScore: number;
  combinedScore: number;
}

/**
 * Lv & Zhai BM25+ Lower-Bounded TF Ranker with Minimal-Span Term Proximity Boosting.
 * Fixes standard Okapi BM25's unfair penalization of long documents by adding a lower-bound
 * constant delta = 1.0 to the normalized term frequency, and rewards adjacent query term spans.
 */
export class Bm25PlusAndSpanProximityRanker {
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9а-яё_]+/i)
      .filter((t) => t.length > 0);
  }

  public static rankDocuments(
    documents: Array<{ docId: string; text: string }>,
    queryText: string,
    options?: { k1?: number; b?: number; delta?: number }
  ): RankedDocumentScore[] {
    const k1 = options?.k1 ?? 1.2;
    const b = options?.b ?? 0.75;
    const delta = options?.delta ?? 1.0;

    const qTerms = [...new Set(Bm25PlusAndSpanProximityRanker.tokenize(queryText))];
    const tokenizedDocs = documents.map((d) => ({
      docId: d.docId,
      tokens: Bm25PlusAndSpanProximityRanker.tokenize(d.text)
    }));

    const N = Math.max(1, tokenizedDocs.length);
    const avgDl =
      tokenizedDocs.reduce((acc, d) => acc + d.tokens.length, 0) / N || 1;

    const df = new Map<string, number>();
    for (const qt of qTerms) {
      let count = 0;
      for (const d of tokenizedDocs) {
        if (d.tokens.includes(qt)) count++;
      }
      df.set(qt, count);
    }

    const scores: RankedDocumentScore[] = [];
    for (const d of tokenizedDocs) {
      const dl = d.tokens.length;
      const tfMap = new Map<string, number>();
      const positionsMap = new Map<string, number[]>();

      d.tokens.forEach((tok, idx) => {
        tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
        const arr = positionsMap.get(tok);
        if (arr) arr.push(idx);
        else positionsMap.set(tok, [idx]);
      });

      let bm25Plus = 0;
      for (const qt of qTerms) {
        const tf = tfMap.get(qt) ?? 0;
        if (tf === 0) continue;
        const nq = df.get(qt) ?? 0;
        const idf = Math.log(1 + (N - nq + 0.5) / (nq + 0.5));
        const normTf =
          ((k1 + 1) * tf) / (k1 * (1 - b + b * (dl / avgDl)) + tf) + delta;
        bm25Plus += idf * normTf;
      }

      // Compute inverse distance proximity boost for consecutive query terms
      let proxBoost = 0;
      for (let i = 0; i + 1 < qTerms.length; i++) {
        const posA = positionsMap.get(qTerms[i]!) ?? [];
        const posB = positionsMap.get(qTerms[i + 1]!) ?? [];
        if (posA.length === 0 || posB.length === 0) continue;
        let minSpan = Infinity;
        for (const a of posA) {
          for (const bPos of posB) {
            const dist = Math.abs(bPos - a);
            if (dist < minSpan) minSpan = dist;
          }
        }
        if (Number.isFinite(minSpan) && minSpan > 0) {
          proxBoost += 1 / (minSpan * minSpan);
        }
      }

      const combined = bm25Plus + proxBoost;
      scores.push({
        docId: d.docId,
        bm25PlusScore: Number(bm25Plus.toFixed(6)),
        proximityBoostScore: Number(proxBoost.toFixed(6)),
        combinedScore: Number(combined.toFixed(6))
      });
    }

    return scores.sort(
      (a, b) => b.combinedScore - a.combinedScore || a.docId.localeCompare(b.docId)
    );
  }
}
