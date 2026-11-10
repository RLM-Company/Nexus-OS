export interface YenDirectedEdge {
  from: string;
  to: string;
  weight: number;
}

export interface YenPathCandidate {
  nodes: string[];
  totalWeight: number;
}

/**
 * Jin Y. Yen's K-Shortest Loopless Paths Router.
 * Computes the top-K distinct simple (loopless) shortest paths from source to target
 * by iteratively spur-branching from every node along the (k-1)-th shortest path while
 * masking prefix-sharing root edges and visited root vertices.
 */
export class YenKShortestLooplessPathsRouter {
  private static dijkstraWithExclusions(
    vertices: string[],
    edges: YenDirectedEdge[],
    source: string,
    target: string,
    bannedNodes: Set<string>,
    bannedEdgeKeys: Set<string>
  ): YenPathCandidate | null {
    if (bannedNodes.has(source) || bannedNodes.has(target)) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const visited = new Set<string>();

    for (const v of vertices) {
      if (!bannedNodes.has(v)) dist.set(v, Infinity);
    }
    dist.set(source, 0);

    const adj = new Map<string, YenDirectedEdge[]>();
    for (const e of edges) {
      if (bannedNodes.has(e.from) || bannedNodes.has(e.to)) continue;
      if (bannedEdgeKeys.has(`${e.from}->${e.to}`)) continue;
      const list = adj.get(e.from) ?? [];
      list.push(e);
      adj.set(e.from, list);
    }

    while (true) {
      let bestU: string | null = null;
      let bestD = Infinity;
      for (const [v, d] of dist.entries()) {
        if (!visited.has(v) && d < bestD) {
          bestD = d;
          bestU = v;
        }
      }
      if (bestU === null || bestU === target) break;
      visited.add(bestU);

      for (const e of adj.get(bestU) ?? []) {
        if (visited.has(e.to)) continue;
        const cand = bestD + e.weight;
        if (cand < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, cand);
          prev.set(e.to, bestU);
        }
      }
    }

    const total = dist.get(target) ?? Infinity;
    if (!Number.isFinite(total)) return null;

    const nodes: string[] = [];
    let curr: string | undefined = target;
    while (curr !== undefined) {
      nodes.push(curr);
      curr = prev.get(curr);
    }
    nodes.reverse();
    return { nodes, totalWeight: Number(total.toFixed(6)) };
  }

  public static findKShortestPaths(
    vertices: string[],
    edges: YenDirectedEdge[],
    source: string,
    target: string,
    kPaths: number = 3
  ): YenPathCandidate[] {
    const A: YenPathCandidate[] = [];
    const B = new Map<string, YenPathCandidate>();

    const first = YenKShortestLooplessPathsRouter.dijkstraWithExclusions(
      vertices,
      edges,
      source,
      target,
      new Set(),
      new Set()
    );
    if (!first) return [];
    A.push(first);

    const edgeWeightMap = new Map<string, number>();
    for (const e of edges) {
      const key = `${e.from}->${e.to}`;
      const prev = edgeWeightMap.get(key) ?? Infinity;
      if (e.weight < prev) edgeWeightMap.set(key, e.weight);
    }

    const computePathWeight = (nodes: string[]): number => {
      let sum = 0;
      for (let i = 0; i + 1 < nodes.length; i++) {
        sum += edgeWeightMap.get(`${nodes[i]}->${nodes[i + 1]}`) ?? 0;
      }
      return Number(sum.toFixed(6));
    };

    for (let k = 1; k < kPaths; k++) {
      const prevPath = A[k - 1]!.nodes;

      for (let i = 0; i < prevPath.length - 1; i++) {
        const spurNode = prevPath[i]!;
        const rootPath = prevPath.slice(0, i + 1);

        const bannedEdges = new Set<string>();
        for (const p of A) {
          if (
            p.nodes.length > i + 1 &&
            p.nodes.slice(0, i + 1).join("::") === rootPath.join("::")
          ) {
            bannedEdges.add(`${p.nodes[i]}->${p.nodes[i + 1]}`);
          }
        }

        const bannedNodes = new Set<string>(rootPath.slice(0, -1));
        const spurPath = YenKShortestLooplessPathsRouter.dijkstraWithExclusions(
          vertices,
          edges,
          spurNode,
          target,
          bannedNodes,
          bannedEdges
        );

        if (spurPath) {
          const totalNodes = [...rootPath.slice(0, -1), ...spurPath.nodes];
          const key = totalNodes.join("->");
          if (!B.has(key) && !A.some((a) => a.nodes.join("->") === key)) {
            B.set(key, {
              nodes: totalNodes,
              totalWeight: computePathWeight(totalNodes)
            });
          }
        }
      }

      if (B.size === 0) break;

      const sortedCandidates = [...B.entries()].sort(
        (a, b) => a[1].totalWeight - b[1].totalWeight || a[0].localeCompare(b[0])
      );
      const [bestKey, bestCand] = sortedCandidates[0]!;
      B.delete(bestKey);
      A.push(bestCand);
    }

    return A;
  }
}
