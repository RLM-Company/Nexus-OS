export interface HouseholderQrResult {
  orthogonalMatrixQ: number[][];
  upperTriangularMatrixR: number[][];
  leastSquaresSolutionX: number[];
  residualNormL2: number;
}

/**
 * Alston Householder's Orthogonal Reflection QR Factorization & Overdetermined Least-Squares Solver.
 * Decomposes an m x n matrix A (m >= n) into A = Q * R using numerically stable Householder
 * reflectors H_k = I - 2 * v_k * v_k^T / (v_k^T * v_k), then solves R_{1:n, 1:n} x = (Q^T b)_{1:n}
 * via back-substitution to minimize ||A x - b||_2.
 */
export class HouseholderQrLeastSquaresSolver {
  public static solveLeastSquaresQr(matrixA: number[][], vectorB: number[]): HouseholderQrResult {
    const m = matrixA.length;
    const n = matrixA[0]?.length ?? 0;

    const R = matrixA.map((row) => [...row]);
    let Q: number[][] = Array.from({ length: m }, (_, i) =>
      Array.from({ length: m }, (__, j) => (i === j ? 1 : 0))
    );

    for (let k = 0; k < Math.min(m, n); k++) {
      // Extract subcolumn x = R[k..m-1, k]
      const len = m - k;
      const x = new Array<number>(len);
      let normX = 0;
      for (let i = 0; i < len; i++) {
        x[i] = R[k + i]![k]!;
        normX += x[i]! * x[i]!;
      }
      normX = Math.sqrt(normX);
      if (normX < 1e-14) continue;

      const sign = x[0]! >= 0 ? 1 : -1;
      const v = [...x];
      v[0]! += sign * normX;

      let vNormSq = 0;
      for (const vi of v) vNormSq += vi * vi;
      if (vNormSq < 1e-14) continue;

      // Apply reflector H_k to R[k..m-1, k..n-1]: R := R - 2 * v * (v^T R) / (v^T v)
      for (let j = k; j < n; j++) {
        let dot = 0;
        for (let i = 0; i < len; i++) {
          dot += v[i]! * R[k + i]![j]!;
        }
        const scale = (2 * dot) / vNormSq;
        for (let i = 0; i < len; i++) {
          R[k + i]![j]! -= scale * v[i]!;
        }
      }

      // Accumulate Q := Q * H_k => for each row r of Q, Q[r, k..m-1] -= 2 * (Q[r, k..m-1] * v) * v^T / vNormSq
      for (let r = 0; r < m; r++) {
        let dot = 0;
        for (let i = 0; i < len; i++) {
          dot += Q[r]![k + i]! * v[i]!;
        }
        const scale = (2 * dot) / vNormSq;
        for (let i = 0; i < len; i++) {
          Q[r]![k + i]! -= scale * v[i]!;
        }
      }
    }

    // Compute qtB = Q^T * b
    const qtB = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let r = 0; r < m; r++) {
        s += Q[r]![i]! * vectorB[r]!;
      }
      qtB[i] = s;
    }

    // Back-substitution on upper n x n block of R
    const solX = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = qtB[i]!;
      for (let j = i + 1; j < n; j++) {
        sum -= R[i]![j]! * solX[j]!;
      }
      const diag = R[i]![i]!;
      solX[i] = Math.abs(diag) > 1e-12 ? sum / diag : 0;
    }

    // Compute L2 residual ||A x - b||_2
    let resSq = 0;
    for (let r = 0; r < m; r++) {
      let ax = 0;
      for (let c = 0; c < n; c++) {
        ax += matrixA[r]![c]! * solX[c]!;
      }
      const err = ax - vectorB[r]!;
      resSq += err * err;
    }

    return {
      orthogonalMatrixQ: Q.map((row) => row.map((v) => Number(v.toFixed(6)))),
      upperTriangularMatrixR: R.map((row) => row.map((v) => Number(v.toFixed(6)))),
      leastSquaresSolutionX: solX.map((v) => Number(v.toFixed(6))),
      residualNormL2: Number(Math.sqrt(resSq).toFixed(6))
    };
  }
}
