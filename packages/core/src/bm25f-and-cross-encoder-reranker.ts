export interface MultiFieldDocument {
  id: string;
  title: string;
  tags: string[];
  body: string;
  denseSimilarityScore?: number; // Optional precomputed cosine similarity [0..1]
}

export interface RerankedDocumentMatch {
  id: string;
  title: string;
  bm25fScore: number;
  crossEncoderInteractionScore: number;
  finalFusedScore: number;
}

function tokenizeLower(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9\u0400-\u04ff_]+/g) ?? [];
}

/**
 * BM25F Multi-Field Lexical Scorer + Pairwise Cross-Encoder Interaction Reranker.
 * Combines field-weighted BM25F (title 3.0x, tags 2.5x, body 1.0x) with exact-span
 * and bigram-proximity Cross-Encoder reranking.
 */
export class Bm25fAndCrossEncoderReranker {
  public static searchAndRerank(params: {
    query: string;
    documents: MultiFieldDocument[];
    k1?: number;
    b?: number;
    topK?: number;
  }): RerankedDocumentMatch[] {
    const k1 = params.k1 ?? 1.5;
    const b = params.b ?? 0.75;
    const topK = params.topK ?? 10;
    const queryTokens = tokenizeLower(params.query);

    if (queryTokens.length === 0 || params.documents.length === 0) {
      return [];
    }

    const nDocs = params.documents.length;

    // Tokenize fields and compute weighted pseudo-document lengths (title=3.0, tags=2.5, body=1.0)
    const preparedDocs = params.documents.map((doc) => {
      const titleTokens = tokenizeLower(doc.title);
      const tagTokens = tokenizeLower(doc.tags.join(" "));
      const bodyTokens = tokenizeLower(doc.body);

      const weightedFreqs = new Map<string, number>();
      const addWeighted = (tokens: string[], weight: number) => {
        for (const t of tokens) {
          weightedFreqs.set(t, (weightedFreqs.get(t) ?? 0) + weight);
        }
      };
      addWeighted(titleTokens, 3.0);
      addWeighted(tagTokens, 2.5);
      addWeighted(bodyTokens, 1.0);

      const weightedLength =
        titleTokens.length * 3.0 + tagTokens.length * 2.5 + bodyTokens.length * 1.0;

      return {
        doc,
        allTokens: [...titleTokens, ...tagTokens, ...bodyTokens],
        weightedFreqs,
        weightedLength
      };
    });

    const avgWeightedLen =
      preparedDocs.reduce((acc, d) => acc + d.weightedLength, 0) / Math.max(1, nDocs);

    // Compute IDF per unique query term
    const uniqueQueryTerms = Array.from(new Set(queryTokens));
    const idfByTerm = new Map<string, number>();
    for (const term of uniqueQueryTerms) {
      let df = 0;
      for (const pd of preparedDocs) {
        if ((pd.weightedFreqs.get(term) ?? 0) > 0) df++;
      }
      // Robertson-Sparck Jones smoothed IDF
      const idf = Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
      idfByTerm.set(term, idf);
    }

    const lowerQuery = params.query.trim().toLowerCase();
    const results: RerankedDocumentMatch[] = [];

    for (const pd of preparedDocs) {
      // 1. BM25F score
      let bm25fScore = 0;
      let matchedQueryTerms = 0;
      for (const term of uniqueQueryTerms) {
        const tfw = pd.weightedFreqs.get(term) ?? 0;
        if (tfw <= 0) continue;
        matchedQueryTerms++;
        const idf = idfByTerm.get(term) ?? 0;
        const normLen = pd.weightedLength / Math.max(1, avgWeightedLen);
        const denom = tfw + k1 * (1 - b + b * normLen);
        bm25fScore += idf * ((tfw * (k1 + 1)) / denom);
      }

      // 2. Cross-Encoder interaction features:
      //    - Exact query substring presence in title or body
      //    - Ordered query bigram adjacency count
      //    - Query term coverage fraction
      const fullLower = `${pd.doc.title} ${pd.doc.body}`.toLowerCase();
      const exactPhraseBonus = lowerQuery.length >= 4 && fullLower.includes(lowerQuery) ? 1.5 : 0;

      let bigramAdjacencyHits = 0;
      if (queryTokens.length >= 2) {
        for (let qIdx = 0; qIdx < queryTokens.length - 1; qIdx++) {
          const w1 = queryTokens[qIdx]!;
          const w2 = queryTokens[qIdx + 1]!;
          for (let dIdx = 0; dIdx < pd.allTokens.length - 1; dIdx++) {
            if (pd.allTokens[dIdx] === w1 && pd.allTokens[dIdx + 1] === w2) {
              bigramAdjacencyHits++;
              break;
            }
          }
        }
      }

      const coverageRatio = matchedQueryTerms / uniqueQueryTerms.length;
      const denseBonus = pd.doc.denseSimilarityScore ?? 0;
      const crossEncoderInteractionScore = Number(
        (exactPhraseBonus + bigramAdjacencyHits * 0.6 + coverageRatio * 1.2 + denseBonus * 0.8).toFixed(
          4
        )
      );

      const finalFusedScore = Number(
        (bm25fScore * 0.55 + crossEncoderInteractionScore * 1.45).toFixed(4)
      );

      if (finalFusedScore > 0) {
        results.push({
          id: pd.doc.id,
          title: pd.doc.title,
          bm25fScore: Number(bm25fScore.toFixed(4)),
          crossEncoderInteractionScore,
          finalFusedScore
        });
      }
    }

    results.sort((a, b) => b.finalFusedScore - a.finalFusedScore);
    return results.slice(0, topK);
  }
}
