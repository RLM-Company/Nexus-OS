export interface SweepConductanceResult {
  minimumConductancePhi: number;
  cheegerLowerBoundLambda2: number;
  cheegerUpperBoundLambda2: number;
  optimalSweepCutSetS: string[];
  complementSetBarS: string[];
}

/**
 * Cheeger Conductance & Sweep-Cut Expander Graph Auditor.
 * Given a vertex ordering (e.g. Fiedler vector ordering or degree-normalized random walk ordering),
 * sweeps all prefix cuts S_k = {v_0, ..., v_k} and computes the conductance
 * Phi(S) = cut(S, V \ S) / min(vol(S), vol(V \ S)), along with Cheeger's spectral gap bounds:
 *   Phi^2 / 2 <= lambda_2 <= 2 * Phi.
 */
export class CheegerConductanceAndSweepCutAuditor {
  public static auditSweepCutConductance(
    orderedNodes: string[],
    undirectedEdges: Array<{ u: string; v: string; weight?: number }>
  ): SweepConductanceResult {
    const n = orderedNodes.length;
    if (n <= 1) {
      return {
        minimumConductancePhi: 0,
        cheegerLowerBoundLambda2: 0,
        cheegerUpperBoundLambda2: 0,
        optimalSweepCutSetS: [...orderedNodes],
        complementSetBarS: []
      };
    }

    const posByNode = new Map<string, number>(orderedNodes.map((id, i) => [id, i]));
    const degree = new Array<number>(n).fill(0);
    const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => []);

    let totalVolume = 0;
    for (const e of undirectedEdges) {
      const u = posByNode.get(e.u);
      const v = posByNode.get(e.v);
      const w = e.weight ?? 1;
      if (u !== undefined && v !== undefined && u !== v) {
        adj[u]!.push({ to: v, w });
        adj[v]!.push({ to: u, w });
        degree[u]! += w;
        degree[v]! += w;
        totalVolume += 2 * w;
      }
    }

    let inPrefix = new Array<boolean>(n).fill(false);
    let cutWeight = 0;
    let volS = 0;

    let minPhi = Infinity;
    let bestSplitIdx = 0;

    for (let k = 0; k < n - 1; k++) {
      inPrefix[k] = true;
      volS += degree[k]!;
      for (const nb of adj[k]!) {
        if (inPrefix[nb.to]) {
          cutWeight -= nb.w;
        } else {
          cutWeight += nb.w;
        }
      }

      const denom = Math.min(volS, totalVolume - volS);
      if (denom > 0) {
        const phi = cutWeight / denom;
        if (phi < minPhi) {
          minPhi = phi;
          bestSplitIdx = k;
        }
      }
    }

    if (!Number.isFinite(minPhi)) minPhi = 0;

    return {
      minimumConductancePhi: Number(minPhi.toFixed(6)),
      cheegerLowerBoundLambda2: Number(((minPhi * minPhi) / 2).toFixed(6)),
      cheegerUpperBoundLambda2: Number((2 * minPhi).toFixed(6)),
      optimalSweepCutSetS: orderedNodes.slice(0, bestSplitIdx + 1),
      complementSetBarS: orderedNodes.slice(bestSplitIdx + 1)
    };
  }
}
