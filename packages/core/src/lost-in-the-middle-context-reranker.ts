export interface ContextChunkItem {
  id: string;
  content: string;
  relevanceScore: number; // [0..1]
  containsMandatoryConstraint?: boolean;
}

export interface UShapedContextLayout {
  orderedChunks: ContextChunkItem[];
  primacyBoundaryIds: string[];
  recencyBoundaryIds: string[];
  middleIds: string[];
}

/**
 * "Lost-in-the-Middle" U-Shaped Attention Context Re-Ranker.
 * Mitigates mid-context attention degradation in long-context LLMs by placing the highest-priority
 * chunks at the very beginning (Primacy) and very end (Recency) of the context block, while
 * relegating lower-priority chunks to the middle.
 */
export class LostInTheMiddleContextReranker {
  public static arrangeUShapedContext(chunks: ContextChunkItem[]): UShapedContextLayout {
    if (chunks.length === 0) {
      return {
        orderedChunks: [],
        primacyBoundaryIds: [],
        recencyBoundaryIds: [],
        middleIds: []
      };
    }

    // Sort descending by effective priority (mandatory constraints get +1.0 boost)
    const sortedDesc = [...chunks].sort((a, b) => {
      const scoreA = a.relevanceScore + (a.containsMandatoryConstraint ? 1.0 : 0);
      const scoreB = b.relevanceScore + (b.containsMandatoryConstraint ? 1.0 : 0);
      return scoreB - scoreA;
    });

    const leftPrimacy: ContextChunkItem[] = [];
    const rightRecency: ContextChunkItem[] = [];

    // Alternate placing highest-ranked items at the start (leftPrimacy) and end (rightRecency)
    // so rank #1 is first, rank #2 is last, rank #3 is second, rank #4 is second-to-last, etc.
    for (let i = 0; i < sortedDesc.length; i++) {
      if (i % 2 === 0) {
        leftPrimacy.push(sortedDesc[i]!);
      } else {
        rightRecency.unshift(sortedDesc[i]!);
      }
    }

    const orderedChunks = [...leftPrimacy, ...rightRecency];
    const kEdge = Math.max(1, Math.ceil(orderedChunks.length * 0.25));
    const primacyBoundaryIds = orderedChunks.slice(0, kEdge).map((c) => c.id);
    const recencyBoundaryIds = orderedChunks.slice(orderedChunks.length - kEdge).map((c) => c.id);
    const middleIds = orderedChunks
      .slice(kEdge, Math.max(kEdge, orderedChunks.length - kEdge))
      .map((c) => c.id);

    return {
      orderedChunks,
      primacyBoundaryIds,
      recencyBoundaryIds,
      middleIds
    };
  }
}
