export interface JacobiEigenResult {
  eigenvalues: number[];
  eigenvectorsColumns: number[][];
  sweepsExecuted: number;
}

export interface PcaProjectionResult {
  eigenvalues: number[];
  explainedVarianceRatio: number[];
  projectedSamples: number[][];
}

/**
 * Classical Jacobi Cyclic Givens Rotation Symmetric Eigenvalue Solver & PCA Reducer.
 * Diagonalizes any real symmetric matrix A = V * Lambda * V^T by zeroing the largest
 * off-diagonal element A_{pq} via exact orthogonal Givens rotations until convergence.
 */
export class JacobiSymmetricEigenvaluePcaEngine {
  public static solveSymmetricEigen(
    symmetricMatrix: number[][],
    options?: { maxSweeps?: number; tolerance?: number }
  ): JacobiEigenResult {
    const n = symmetricMatrix.length;
    const tol = options?.tolerance ?? 1e-10;
    const maxSweeps = options?.maxSweeps ?? 100;

    const A = symmetricMatrix.map((row) => [...row]);
    const V: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => (i === j ? 1 : 0))
    );

    let sweeps = 0;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      // Find largest off-diagonal entry |A[p][q]|
      let maxOff = 0;
      let p = 0;
      let q = 1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const val = Math.abs(A[i]![j]!);
          if (val > maxOff) {
            maxOff = val;
            p = i;
            q = j;
          }
        }
      }
      if (maxOff < tol) break;
      sweeps++;

      const app = A[p]![p]!;
      const aqq = A[q]![q]!;
      const apq = A[p]![q]!;

      const tau = (aqq - app) / (2 * apq);
      const t =
        tau >= 0
          ? 1 / (tau + Math.sqrt(1 + tau * tau))
          : -1 / (-tau + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      A[p]![p] = app - t * apq;
      A[q]![q] = aqq + t * apq;
      A[p]![q] = 0;
      A[q]![p] = 0;

      for (let r = 0; r < n; r++) {
        if (r !== p && r !== q) {
          const arp = A[r]![p]!;
          const arq = A[r]![q]!;
          A[r]![p] = c * arp - s * arq;
          A[p]![r] = A[r]![p]!;
          A[r]![q] = s * arp + c * arq;
          A[q]![r] = A[r]![q]!;
        }
      }

      for (let r = 0; r < n; r++) {
        const vrp = V[r]![p]!;
        const vrq = V[r]![q]!;
        V[r]![p] = c * vrp - s * vrq;
        V[r]![q] = s * vrp + c * vrq;
      }
    }

    // Sort eigenvalues descending
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[b]![b]! - A[a]![a]!);
    const eigenvalues = order.map((idx) => Number(A[idx]![idx]!.toFixed(8)));
    const eigenvectorsColumns = Array.from({ length: n }, (_, r) =>
      order.map((cIdx) => Number(V[r]![cIdx]!.toFixed(8)))
    );

    return {
      eigenvalues,
      eigenvectorsColumns,
      sweepsExecuted: sweeps
    };
  }

  public static computePcaProjection(
    samples: number[][],
    targetComponentsK: number
  ): PcaProjectionResult {
    const m = samples.length;
    const d = samples[0]?.length ?? 0;
    const means = new Array<number>(d).fill(0);
    for (const s of samples) {
      for (let j = 0; j < d; j++) means[j]! += s[j]!;
    }
    for (let j = 0; j < d; j++) means[j]! /= Math.max(1, m);

    const centered = samples.map((s) => s.map((v, j) => v - means[j]!));
    const cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const denom = Math.max(1, m - 1);
    for (const row of centered) {
      for (let i = 0; i < d; i++) {
        for (let j = i; j < d; j++) {
          cov[i]![j]! += (row[i]! * row[j]!) / denom;
        }
      }
    }
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < i; j++) {
        cov[i]![j] = cov[j]![i]!;
      }
    }

    const eig = JacobiSymmetricEigenvaluePcaEngine.solveSymmetricEigen(cov);
    const totalVar = eig.eigenvalues.reduce((acc, v) => acc + Math.max(0, v), 0) || 1;
    const explainedVarianceRatio = eig.eigenvalues.map((v) =>
      Number((Math.max(0, v) / totalVar).toFixed(6))
    );

    const k = Math.min(targetComponentsK, d);
    const projectedSamples = centered.map((row) =>
      Array.from({ length: k }, (_, comp) => {
        let dot = 0;
        for (let j = 0; j < d; j++) {
          dot += row[j]! * eig.eigenvectorsColumns[j]![comp]!;
        }
        return Number(dot.toFixed(6));
      })
    );

    return {
      eigenvalues: eig.eigenvalues,
      explainedVarianceRatio,
      projectedSamples
    };
  }
}
