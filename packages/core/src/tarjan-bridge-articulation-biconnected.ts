export interface BiconnectedTopologyReport {
  articulationPoints: string[];
  bridgeEdges: Array<{ u: string; v: string }>;
  isTwoEdgeConnected: boolean;
}

/**
 * Robert Tarjan's O(V + E) Depth-First Low-Link Bridge & Articulation Point Analyzer.
 * Identifies all single-point-of-failure (SPOF) cut vertices and bridge edges in an
 * undirected topology graph.
 */
export class TarjanBiconnectedArticulationAnalyzer {
  public static analyzeTopology(
    nodes: string[],
    undirectedEdges: Array<{ u: string; v: string }>
  ): BiconnectedTopologyReport {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of undirectedEdges) {
      if (!adj.has(e.u)) adj.set(e.u, []);
      if (!adj.has(e.v)) adj.set(e.v, []);
      adj.get(e.u)!.push(e.v);
      adj.get(e.v)!.push(e.u);
    }

    const disc = new Map<string, number>();
    const low = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const articulationSet = new Set<string>();
    const bridges: Array<{ u: string; v: string }> = [];
    let timer = 0;

    const dfs = (u: string): void => {
      timer++;
      disc.set(u, timer);
      low.set(u, timer);
      let childrenCount = 0;

      for (const v of adj.get(u) ?? []) {
        if (!disc.has(v)) {
          childrenCount++;
          parent.set(v, u);
          dfs(v);
          low.set(u, Math.min(low.get(u)!, low.get(v)!));

          const p = parent.get(u) ?? null;
          if (p === null && childrenCount > 1) {
            articulationSet.add(u);
          }
          if (p !== null && low.get(v)! >= disc.get(u)!) {
            articulationSet.add(u);
          }
          if (low.get(v)! > disc.get(u)!) {
            const [a, b] = u < v ? [u, v] : [v, u];
            bridges.push({ u: a, v: b });
          }
        } else if (v !== (parent.get(u) ?? null)) {
          low.set(u, Math.min(low.get(u)!, disc.get(v)!));
        }
      }
    };

    for (const n of nodes) {
      if (!disc.has(n)) {
        parent.set(n, null);
        dfs(n);
      }
    }

    return {
      articulationPoints: [...articulationSet].sort(),
      bridgeEdges: bridges.sort((a, b) => a.u.localeCompare(b.u) || a.v.localeCompare(b.v)),
      isTwoEdgeConnected: bridges.length === 0 && nodes.length > 0
    };
  }
}
