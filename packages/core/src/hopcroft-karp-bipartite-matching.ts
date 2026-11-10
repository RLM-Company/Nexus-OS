export interface BipartiteMatchingAndCoverResult {
  matchingPairs: Array<{ left: string; right: string }>;
  maximumMatchingSize: number;
  minimumVertexCoverLeft: string[];
  minimumVertexCoverRight: string[];
  minimumVertexCoverSize: number;
}

/**
 * Hopcroft-Karp O(E * sqrt(V)) Maximum Cardinality Bipartite Matching &
 * König's Theorem Minimum Vertex Cover Extractor.
 */
export class HopcroftKarpMaximumMatchingEngine {
  public static computeMaximumMatchingAndVertexCover(params: {
    leftNodes: string[];
    rightNodes: string[];
    edges: Array<{ left: string; right: string }>;
  }): BipartiteMatchingAndCoverResult {
    const adj = new Map<string, string[]>();
    for (const u of params.leftNodes) adj.set(u, []);
    for (const e of params.edges) {
      if (!adj.has(e.left)) adj.set(e.left, []);
      adj.get(e.left)!.push(e.right);
    }

    const pairU = new Map<string, string | null>();
    const pairV = new Map<string, string | null>();
    const dist = new Map<string, number>();

    for (const u of params.leftNodes) pairU.set(u, null);
    for (const v of params.rightNodes) pairV.set(v, null);

    const bfs = (): boolean => {
      const queue: string[] = [];
      let foundAugmentingPath = false;

      for (const u of params.leftNodes) {
        if (pairU.get(u) === null) {
          dist.set(u, 0);
          queue.push(u);
        } else {
          dist.set(u, Infinity);
        }
      }

      while (queue.length > 0) {
        const u = queue.shift()!;
        const dU = dist.get(u)!;

        for (const v of adj.get(u) ?? []) {
          const matchedNextU = pairV.get(v) ?? null;
          if (matchedNextU === null) {
            foundAugmentingPath = true;
          } else if (dist.get(matchedNextU) === Infinity) {
            dist.set(matchedNextU, dU + 1);
            queue.push(matchedNextU);
          }
        }
      }

      return foundAugmentingPath;
    };

    const dfs = (u: string): boolean => {
      const dU = dist.get(u)!;
      for (const v of adj.get(u) ?? []) {
        const matchedNextU = pairV.get(v) ?? null;
        if (
          matchedNextU === null ||
          (dist.get(matchedNextU) === dU + 1 && dfs(matchedNextU))
        ) {
          pairU.set(u, v);
          pairV.set(v, u);
          return true;
        }
      }
      dist.set(u, Infinity);
      return false;
    };

    let matchingSize = 0;
    while (bfs()) {
      for (const u of params.leftNodes) {
        if (pairU.get(u) === null && dfs(u)) {
          matchingSize++;
        }
      }
    }

    // König's Theorem Minimum Vertex Cover extraction:
    // Alternate reachability Z from unmatched left vertices (L -> R along non-matching edges, R -> L along matching edges)
    // Minimum Vertex Cover = (L \ Z_L) U (R n Z_R)
    const zLeft = new Set<string>();
    const zRight = new Set<string>();
    const altQueue: string[] = [];

    for (const u of params.leftNodes) {
      if (pairU.get(u) === null) {
        zLeft.add(u);
        altQueue.push(u);
      }
    }

    while (altQueue.length > 0) {
      const u = altQueue.shift()!;
      for (const v of adj.get(u) ?? []) {
        if (pairU.get(u) === v) continue; // Only traverse non-matching edge L -> R
        if (!zRight.has(v)) {
          zRight.add(v);
          const mateU = pairV.get(v) ?? null;
          if (mateU !== null && !zLeft.has(mateU)) {
            zLeft.add(mateU);
            altQueue.push(mateU);
          }
        }
      }
    }

    const minimumVertexCoverLeft = params.leftNodes.filter((u) => !zLeft.has(u));
    const minimumVertexCoverRight = params.rightNodes.filter((v) => zRight.has(v));

    const matchingPairs: Array<{ left: string; right: string }> = [];
    for (const [u, v] of pairU.entries()) {
      if (v !== null) {
        matchingPairs.push({ left: u, right: v });
      }
    }

    return {
      matchingPairs,
      maximumMatchingSize: matchingSize,
      minimumVertexCoverLeft,
      minimumVertexCoverRight,
      minimumVertexCoverSize:
        minimumVertexCoverLeft.length + minimumVertexCoverRight.length
    };
  }
}
