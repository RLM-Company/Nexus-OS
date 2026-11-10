export interface GomoryHuTreeEdge {
  u: string;
  v: string;
  minCutCapacity: number;
}

export interface GomoryHuTreeResult {
  treeEdges: GomoryHuTreeEdge[];
  allPairsMinCutMatrix: Record<string, Record<string, number>>;
}

/**
 * Ralph Gomory & T.C. Hu's All-Pairs Minimum s-t Cut Tree ( Gusfield's Equivalent Flow Tree ).
 * Constructs a weighted tree on V using exactly |V| - 1 s-t minimum-cut (Edmonds-Karp max-flow)
 * evaluations such that the minimum weight edge along the unique tree path between any u and v
 * equals their exact pairwise minimum s-t cut capacity in the original undirected graph.
 */
export class GomoryHuAllPairsMinCutTreeEngine {
  private static edmondsKarpMinCut(
    n: number,
    capacityMatrix: number[][],
    source: number,
    sink: number
  ): { maxFlow: number; sourceSideVisited: boolean[] } {
    const residual = capacityMatrix.map((r) => [...r]);
    let maxFlow = 0;

    while (true) {
      const parent = new Array<number>(n).fill(-1);
      parent[source] = source;
      const queue = [source];

      while (queue.length > 0 && parent[sink] === -1) {
        const u = queue.shift()!;
        for (let v = 0; v < n; v++) {
          if (parent[v] === -1 && residual[u]![v]! > 1e-9) {
            parent[v] = u;
            queue.push(v);
          }
        }
      }

      if (parent[sink] === -1) break;

      let pathFlow = Infinity;
      for (let v = sink; v !== source; v = parent[v]!) {
        const u = parent[v]!;
        pathFlow = Math.min(pathFlow, residual[u]![v]!);
      }

      for (let v = sink; v !== source; v = parent[v]!) {
        const u = parent[v]!;
        residual[u]![v]! -= pathFlow;
        residual[v]![u]! += pathFlow;
      }
      maxFlow += pathFlow;
    }

    // Reachable from source in residual graph defines S-side of min s-t cut
    const visited = new Array<boolean>(n).fill(false);
    const q = [source];
    visited[source] = true;
    while (q.length > 0) {
      const u = q.shift()!;
      for (let v = 0; v < n; v++) {
        if (!visited[v] && residual[u]![v]! > 1e-9) {
          visited[v] = true;
          q.push(v);
        }
      }
    }

    return { maxFlow, sourceSideVisited: visited };
  }

  public static buildGomoryHuCutTree(
    nodes: string[],
    undirectedEdges: Array<{ u: string; v: string; capacity: number }>
  ): GomoryHuTreeResult {
    const n = nodes.length;
    const idxByNode = new Map<string, number>(nodes.map((id, i) => [id, i]));
    const cap: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const e of undirectedEdges) {
      const u = idxByNode.get(e.u);
      const v = idxByNode.get(e.v);
      if (u !== undefined && v !== undefined && u !== v) {
        cap[u]![v]! += e.capacity;
        cap[v]![u]! += e.capacity;
      }
    }

    // Gusfield's algorithm (1990): star tree rooted at 0, refined in n - 1 max-flow calls
    const parent = new Array<number>(n).fill(0);
    const fl = new Array<number>(n).fill(0);

    for (let i = 1; i < n; i++) {
      const t = parent[i]!;
      const { maxFlow, sourceSideVisited } = GomoryHuAllPairsMinCutTreeEngine.edmondsKarpMinCut(
        n,
        cap,
        i,
        t
      );
      fl[i] = maxFlow;
      for (let j = i + 1; j < n; j++) {
        if (parent[j] === t && sourceSideVisited[j]) {
          parent[j] = i;
        }
      }
      if (sourceSideVisited[parent[t]!]) {
        parent[i] = parent[t]!;
        parent[t] = i;
        fl[i] = fl[t]!;
        fl[t] = maxFlow;
      }
    }

    const treeEdges: GomoryHuTreeEdge[] = [];
    const treeAdj: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => []);
    for (let i = 1; i < n; i++) {
      const p = parent[i]!;
      const w = Number(fl[i]!.toFixed(6));
      treeEdges.push({
        u: nodes[i]!,
        v: nodes[p]!,
        minCutCapacity: w
      });
      treeAdj[i]!.push({ to: p, w });
      treeAdj[p]!.push({ to: i, w });
    }

    // Compute all-pairs bottleneck along unique tree paths
    const allPairsMinCutMatrix: Record<string, Record<string, number>> = {};
    for (let s = 0; s < n; s++) {
      const row: Record<string, number> = {};
      const bottleneck = new Array<number>(n).fill(Infinity);
      const vis = new Array<boolean>(n).fill(false);
      vis[s] = true;
      const q = [s];
      while (q.length > 0) {
        const u = q.shift()!;
        for (const edge of treeAdj[u]!) {
          if (!vis[edge.to]) {
            vis[edge.to] = true;
            bottleneck[edge.to] = Math.min(bottleneck[u]!, edge.w);
            q.push(edge.to);
          }
        }
      }
      for (let t = 0; t < n; t++) {
        row[nodes[t]!] = s === t ? Infinity : Number(bottleneck[t]!.toFixed(6));
      }
      allPairsMinCutMatrix[nodes[s]!] = row;
    }

    return {
      treeEdges,
      allPairsMinCutMatrix
    };
  }
}
