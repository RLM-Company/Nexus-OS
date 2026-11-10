export interface CliqueAndCoreReport {
  maximalCliques: string[][];
  maximumCliqueOmega: number;
  largestClique: string[];
  coreNumberByNode: Record<string, number>;
   graphDegeneracyKMax: number;
}

/**
 * Bron-Kerbosch Maximal Clique Enumerator with Tomita Pivoting &
 * Matula-Beck O(V + E) k-Core Decomposition Engine.
 */
export class BronKerboschPivotCliqueEnumerator {
  public static analyzeCliquesAndCores(
    nodes: string[],
    undirectedEdges: Array<{ u: string; v: string }>
  ): CliqueAndCoreReport {
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n, new Set());
    for (const e of undirectedEdges) {
      if (e.u === e.v) continue;
      if (!adj.has(e.u)) adj.set(e.u, new Set());
      if (!adj.has(e.v)) adj.set(e.v, new Set());
      adj.get(e.u)!.add(e.v);
      adj.get(e.v)!.add(e.u);
    }

    const maximalCliques: string[][] = [];

    const bronKerbosch = (R: Set<string>, P: Set<string>, X: Set<string>) => {
      if (P.size === 0 && X.size === 0) {
        if (R.size > 0) {
          maximalCliques.push(Array.from(R).sort());
        }
        return;
      }

      // Tomita Pivot: choose u in P U X that maximizes |P n N(u)|
      const unionPX = [...P, ...X];
      let pivot = unionPX[0]!;
      let maxCommon = -1;
      for (const cand of unionPX) {
        const neighbors = adj.get(cand)!;
        let common = 0;
        for (const p of P) {
          if (neighbors.has(p)) common++;
        }
        if (common > maxCommon) {
          maxCommon = common;
          pivot = cand;
        }
      }

      const pivotNeighbors = adj.get(pivot)!;
      const candidates = Array.from(P).filter((v) => !pivotNeighbors.has(v));

      for (const v of candidates) {
        const vNeighbors = adj.get(v)!;
        const nextR = new Set(R);
        nextR.add(v);
        const nextP = new Set(Array.from(P).filter((x) => vNeighbors.has(x)));
        const nextX = new Set(Array.from(X).filter((x) => vNeighbors.has(x)));

        bronKerbosch(nextR, nextP, nextX);
        P.delete(v);
        X.add(v);
      }
    };

    bronKerbosch(new Set(), new Set(adj.keys()), new Set());

    maximalCliques.sort((a, b) => b.length - a.length);
    const largestClique = maximalCliques[0] ?? [];

    // Matula-Beck k-Core Decomposition (iteratively peel vertex of minimum current degree)
    const remaining = new Set<string>(adj.keys());
    const curDeg = new Map<string, number>();
    for (const [u, nb] of adj.entries()) {
      curDeg.set(u, nb.size);
    }

    const coreNumberByNode: Record<string, number> = {};
    let currentCoreK = 0;

    while (remaining.size > 0) {
      let minNode: string | null = null;
      let minD = Infinity;
      for (const u of remaining) {
        const d = curDeg.get(u)!;
        if (d < minD) {
          minD = d;
          minNode = u;
        }
      }
      if (!minNode) break;
      currentCoreK = Math.max(currentCoreK, minD);
      coreNumberByNode[minNode] = currentCoreK;
      remaining.delete(minNode);

      for (const nb of adj.get(minNode)!) {
        if (remaining.has(nb)) {
          curDeg.set(nb, curDeg.get(nb)! - 1);
        }
      }
    }

    return {
      maximalCliques,
      maximumCliqueOmega: largestClique.length,
      largestClique,
      coreNumberByNode,
      graphDegeneracyKMax: currentCoreK
    };
  }
}
