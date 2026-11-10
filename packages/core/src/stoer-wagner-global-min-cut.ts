export interface UndirectedWeightedEdge {
  u: string;
  v: string;
  weight: number;
}

export interface GlobalMinCutResult {
  minCutWeight: number;
  partitionA: string[];
  partitionB: string[];
}

/**
 * Mechthild Stoer & Frank Wagner's Deterministic Global Minimum Cut Algorithm.
 * Finds the global minimum cut of an undirected weighted graph in O(V^3) time via
 * Maximum Adjacency Search (MAS) phases and s-t vertex contractions without max-flow.
 */
export class StoerWagnerGlobalMinCutEngine {
  public static computeGlobalMinCut(
    nodes: string[],
    edges: UndirectedWeightedEdge[]
  ): GlobalMinCutResult {
    const n = nodes.length;
    if (n <= 1) {
      return { minCutWeight: 0, partitionA: [...nodes], partitionB: [] };
    }

    const idxByNode = new Map<string, number>(nodes.map((id, i) => [id, i]));
    const W: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const e of edges) {
      const u = idxByNode.get(e.u);
      const v = idxByNode.get(e.v);
      if (u !== undefined && v !== undefined && u !== v) {
        W[u]![v]! += e.weight;
        W[v]![u]! += e.weight;
      }
    }

    // Track which original vertices belong to each supernode
    const members: number[][] = Array.from({ length: n }, (_, i) => [i]);
    const active = new Array<boolean>(n).fill(true);

    let bestCutWeight = Infinity;
    let bestGroupIndices: number[] = [];

    for (let phase = 0; phase < n - 1; phase++) {
      const inA = new Array<boolean>(n).fill(false);
      const weightsToA = new Array<number>(n).fill(0);

      let prev = -1;
      let last = -1;
      const activeCount = n - phase;

      for (let step = 0; step < activeCount; step++) {
        let sel = -1;
        let maxW = -1;
        for (let i = 0; i < n; i++) {
          if (active[i] && !inA[i] && weightsToA[i]! > maxW) {
            maxW = weightsToA[i]!;
            sel = i;
          }
        }
        inA[sel] = true;
        prev = last;
        last = sel;

        for (let j = 0; j < n; j++) {
          if (active[j] && !inA[j]) {
            weightsToA[j]! += W[sel]![j]!;
          }
        }
      }

      // Cut of the phase is weightsToA[last]
      const cutOfPhase = weightsToA[last]!;
      if (cutOfPhase < bestCutWeight) {
        bestCutWeight = cutOfPhase;
        bestGroupIndices = [...members[last]!];
      }

      // Contract `last` into `prev`
      active[last] = false;
      members[prev]!.push(...members[last]!);
      for (let i = 0; i < n; i++) {
        if (i !== prev && active[i]) {
          W[prev]![i]! += W[last]![i]!;
          W[i]![prev]! = W[prev]![i]!;
        }
      }
    }

    const setA = new Set<number>(bestGroupIndices);
    const partitionA = nodes.filter((_, i) => setA.has(i));
    const partitionB = nodes.filter((_, i) => !setA.has(i));

    return {
      minCutWeight: Number(bestCutWeight.toFixed(6)),
      partitionA,
      partitionB
    };
  }
}
