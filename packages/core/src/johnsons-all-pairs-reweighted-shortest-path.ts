export interface WeightedDirectedEdge {
  from: string;
  to: string;
  weight: number;
}

export interface JohnsonAllPairsResult {
  hasNegativeCycle: boolean;
  bellmanFordPotentialsH: Record<string, number>;
  distanceMatrix: Record<string, Record<string, number>>;
}

/**
 * Donald Johnson's O(V E + V^2 log V) Sparse All-Pairs Shortest Paths (APSP) Router.
 * Adds a virtual supersource q with 0-weight edges to all vertices, runs Bellman-Ford to
 * compute vertex potentials h(v) (detecting negative cycles), reweights every edge to
 * non-negative w'(u, v) = w(u, v) + h(u) - h(v) >= 0, runs Dijkstra from each vertex,
 * and restores true shortest path distances d(u, v) = d'(u, v) - h(u) + h(v).
 */
export class JohnsonReweightedSparseAllPairsRouter {
  public static computeAllPairsShortestPaths(
    vertices: string[],
    edges: WeightedDirectedEdge[]
  ): JohnsonAllPairsResult {
    const h = new Map<string, number>();
    for (const v of vertices) {
      h.set(v, 0); // Virtual supersource q has 0-weight edge to every vertex v
    }

    // 1. Bellman-Ford relaxation over |V| - 1 rounds
    for (let round = 0; round < vertices.length - 1; round++) {
      let updated = false;
      for (const e of edges) {
        const hu = h.get(e.from) ?? 0;
        const hv = h.get(e.to) ?? 0;
        if (hu + e.weight < hv) {
          h.set(e.to, hu + e.weight);
          updated = true;
        }
      }
      if (!updated) break;
    }

    // Check for negative-weight cycle
    for (const e of edges) {
      const hu = h.get(e.from) ?? 0;
      const hv = h.get(e.to) ?? 0;
      if (hu + e.weight < hv - 1e-12) {
        return {
          hasNegativeCycle: true,
          bellmanFordPotentialsH: Object.fromEntries(h.entries()),
          distanceMatrix: {}
        };
      }
    }

    // 2. Build non-negative reweighted adjacency list w'(u, v) = w(u, v) + h(u) - h(v) >= 0
    const adj = new Map<string, Array<{ to: string; reweightedW: number }>>();
    for (const v of vertices) adj.set(v, []);
    for (const e of edges) {
      const wPrime = e.weight + (h.get(e.from) ?? 0) - (h.get(e.to) ?? 0);
      adj.get(e.from)!.push({ to: e.to, reweightedW: Math.max(0, wPrime) });
    }

    // 3. Run Dijkstra from every source u and restore true distances
    const distanceMatrix: Record<string, Record<string, number>> = {};
    for (const src of vertices) {
      const distPrime = new Map<string, number>(vertices.map((v) => [v, Infinity]));
      distPrime.set(src, 0);
      const visited = new Set<string>();

      while (visited.size < vertices.length) {
        let bestU: string | null = null;
        let bestD = Infinity;
        for (const v of vertices) {
          if (!visited.has(v) && (distPrime.get(v) ?? Infinity) < bestD) {
            bestD = distPrime.get(v)!;
            bestU = v;
          }
        }
        if (bestU === null) break;
        visited.add(bestU);

        for (const edge of adj.get(bestU) ?? []) {
          const cand = bestD + edge.reweightedW;
          if (cand < (distPrime.get(edge.to) ?? Infinity)) {
            distPrime.set(edge.to, cand);
          }
        }
      }

      distanceMatrix[src] = {};
      const hSrc = h.get(src) ?? 0;
      for (const dst of vertices) {
        const dp = distPrime.get(dst) ?? Infinity;
        distanceMatrix[src]![dst] = Number.isFinite(dp)
          ? Number((dp - hSrc + (h.get(dst) ?? 0)).toFixed(6))
          : Infinity;
      }
    }

    return {
      hasNegativeCycle: false,
      bellmanFordPotentialsH: Object.fromEntries(h.entries()),
      distanceMatrix
    };
  }
}
