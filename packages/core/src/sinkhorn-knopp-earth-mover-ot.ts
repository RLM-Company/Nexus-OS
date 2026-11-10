export interface OptimalTransportResult {
  transportPlanMatrix: number[][];
  wassersteinCost: number;
  iterationsExecuted: number;
  converged: boolean;
}

/**
 * Cuturi's Entropic-Regularized Optimal Transport (Earth Mover's / Wasserstein Distance)
 * via the Sinkhorn-Knopp Alternating Matrix Scaling Algorithm on Gibbs Kernel K = exp(-C / epsilon).
 */
export class EntropicOptimalTransportSinkhorn {
  public static computeOptimalTransport(params: {
    sourceDistributionP: number[]; // sums to 1, length n
    targetDistributionQ: number[]; // sums to 1, length m
    groundCostMatrixC: number[][]; // n x m
    entropicEpsilon?: number;
    maxIterations?: number;
    tolerance?: number;
  }): OptimalTransportResult {
    const n = params.sourceDistributionP.length;
    const m = params.targetDistributionQ.length;
    const eps = Math.max(1e-3, params.entropicEpsilon ?? 0.1);
    const maxIter = params.maxIterations ?? 80;
    const tol = params.tolerance ?? 1e-6;

    // Normalize p and q
    const sumP = Math.max(1e-12, params.sourceDistributionP.reduce((a, b) => a + b, 0));
    const sumQ = Math.max(1e-12, params.targetDistributionQ.reduce((a, b) => a + b, 0));
    const p = params.sourceDistributionP.map((x) => Math.max(1e-9, x / sumP));
    const q = params.targetDistributionQ.map((x) => Math.max(1e-9, x / sumQ));

    // Gibbs kernel K_ij = exp(-C_ij / eps)
    const K: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: m }, (__, j) =>
        Math.max(1e-15, Math.exp(-params.groundCostMatrixC[i]![j]! / eps))
      )
    );

    const u = new Array<number>(n).fill(1.0 / n);
    const v = new Array<number>(m).fill(1.0 / m);

    let converged = false;
    let iter = 0;

    for (; iter < maxIter; iter++) {
      let maxDelta = 0;

      // u = p ./ (K * v)
      for (let i = 0; i < n; i++) {
        let kv = 0;
        for (let j = 0; j < m; j++) {
          kv += K[i]![j]! * v[j]!;
        }
        const nextU = p[i]! / Math.max(1e-15, kv);
        maxDelta = Math.max(maxDelta, Math.abs(nextU - u[i]!));
        u[i] = nextU;
      }

      // v = q ./ (K^T * u)
      for (let j = 0; j < m; j++) {
        let ktu = 0;
        for (let i = 0; i < n; i++) {
          ktu += K[i]![j]! * u[i]!;
        }
        const nextV = q[j]! / Math.max(1e-15, ktu);
        maxDelta = Math.max(maxDelta, Math.abs(nextV - v[j]!));
        v[j] = nextV;
      }

      if (maxDelta <= tol) {
        converged = true;
        iter++;
        break;
      }
    }

    // Coupling matrix P_ij = u_i * K_ij * v_j
    let wassersteinCost = 0;
    const transportPlanMatrix: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: m }, (__, j) => {
        const pij = u[i]! * K[i]![j]! * v[j]!;
        wassersteinCost += pij * params.groundCostMatrixC[i]![j]!;
        return Number(pij.toFixed(6));
      })
    );

    return {
      transportPlanMatrix,
      wassersteinCost: Number(wassersteinCost.toFixed(6)),
      iterationsExecuted: iter,
      converged
    };
  }
}
