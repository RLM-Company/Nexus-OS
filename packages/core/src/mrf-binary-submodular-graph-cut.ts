export interface MrfUnaryCost {
  nodeId: string;
  costLabel0: number;
  costLabel1: number;
}

export interface MrfPairwiseSmoothness {
  u: string;
  v: string;
  disagreementPenaltyLambda: number;
}

export interface MrfEnergyMinimizationResult {
  optimalLabelsByNode: Record<string, 0 | 1>;
  minimumTotalEnergy: number;
}

/**
 * Kolmogorov-Zabin / Greig-Porteous-Seheult Submodular Binary Markov Random Field (MRF)
 * Energy Minimizer via s-t Minimum Graph Cut.
 * Minimizes E(x) = sum_i D_i(x_i) + sum_{(i,j)} lambda_{ij} * [x_i != x_j]
 * by constructing an s-t flow network where source S represents label 0 and sink T represents label 1:
 * - Edge S -> i has capacity D_i(1) (cost of assigning i to T-side / label 0? Wait:
 *   If i is on S-side (label 0), edge (i -> T) is cut! So set capacity(i -> T) = D_i(0) and capacity(S -> i) = D_i(1)!)
 *   Check:
 *   - If x_i = 0 (i in S), edge (i -> T) is cut => pays D_i(0).
 *   - If x_i = 1 (i in T), edge (S -> i) is cut => pays D_i(1).
 *   - If x_i != x_j, undirected edge (i, j) of capacity lambda_{ij} is cut => pays lambda_{ij}!
 */
export class SubmodularMarkovRandomFieldGraphCut {
  public static minimizeBinaryEnergy(
    unaries: MrfUnaryCost[],
    pairwise: MrfPairwiseSmoothness[]
  ): MrfEnergyMinimizationResult {
    const k = unaries.length;
    const S = 0;
    const T = k + 1;
    const totalV = k + 2;

    const idxByNode = new Map<string, number>();
    unaries.forEach((u, idx) => idxByNode.set(u.nodeId, idx + 1));

    const cap: number[][] = Array.from({ length: totalV }, () => new Array<number>(totalV).fill(0));
    let constantOffset = 0;

    for (let i = 0; i < k; i++) {
      const u = unaries[i]!;
      const vIdx = i + 1;
      const minCost = Math.min(u.costLabel0, u.costLabel1);
      constantOffset += minCost;
      const c0 = u.costLabel0 - minCost;
      const c1 = u.costLabel1 - minCost;
      // If vIdx stays in S (label 0), edge (vIdx -> T) is cut => cap(vIdx -> T) = c0
      // If vIdx goes to T (label 1), edge (S -> vIdx) is cut => cap(S -> vIdx) = c1
      cap[vIdx]![T]! += c0;
      cap[S]![vIdx]! += c1;
    }

    for (const p of pairwise) {
      const uIdx = idxByNode.get(p.u);
      const vIdx = idxByNode.get(p.v);
      if (uIdx !== undefined && vIdx !== undefined && uIdx !== vIdx) {
        const w = Math.max(0, p.disagreementPenaltyLambda);
        cap[uIdx]![vIdx]! += w;
        cap[vIdx]![uIdx]! += w;
      }
    }

    // Edmonds-Karp max-flow / min-cut from S to T
    const residual = cap.map((r) => [...r]);
    let maxFlow = 0;
    while (true) {
      const parent = new Array<number>(totalV).fill(-1);
      parent[S] = S;
      const q = [S];
      while (q.length > 0 && parent[T] === -1) {
        const u = q.shift()!;
        for (let v = 0; v < totalV; v++) {
          if (parent[v] === -1 && residual[u]![v]! > 1e-9) {
            parent[v] = u;
            q.push(v);
          }
        }
      }
      if (parent[T] === -1) break;
      let flow = Infinity;
      for (let v = T; v !== S; v = parent[v]!) {
        flow = Math.min(flow, residual[parent[v]!]![v]!);
      }
      for (let v = T; v !== S; v = parent[v]!) {
        const u = parent[v]!;
        residual[u]![v]! -= flow;
        residual[v]![u]! += flow;
      }
      maxFlow += flow;
    }

    // Nodes reachable from S in residual graph receive label 0; unreachable receive label 1
    const reachableS = new Array<boolean>(totalV).fill(false);
    reachableS[S] = true;
    const queue = [S];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (let v = 0; v < totalV; v++) {
        if (!reachableS[v] && residual[u]![v]! > 1e-9) {
          reachableS[v] = true;
          queue.push(v);
        }
      }
    }

    const optimalLabelsByNode: Record<string, 0 | 1> = {};
    for (let i = 0; i < k; i++) {
      const nodeId = unaries[i]!.nodeId;
      optimalLabelsByNode[nodeId] = reachableS[i + 1] ? 0 : 1;
    }

    return {
      optimalLabelsByNode,
      minimumTotalEnergy: Number((constantOffset + maxFlow).toFixed(6))
    };
  }
}
