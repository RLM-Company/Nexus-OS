import { JacobiSymmetricEigenvaluePcaEngine } from "./jacobi-eigenvalue-pca-reducer.ts";

export interface TruncatedSvdResult {
  singularValues: number[];
  leftSingularVectorsU: number[][];
  rightSingularVectorsV: number[][];
  rankKApproximationMatrix: number[][];
  moorePenrosePseudoinverse: number[][];
  frobeniusReconstructionError: number;
}

/**
 * Truncated Singular Value Decomposition (SVD), Eckart-Young-Mirsky Rank-k Low-Rank
 * Matrix Approximator & Moore-Penrose Pseudoinverse A^+ Solver.
 */
export class TruncatedSvdAndPseudoinverseEngine {
  public static computeTruncatedSvd(
    matrixA: number[][],
    rankK?: number
  ): TruncatedSvdResult {
    const m = matrixA.length;
    const n = matrixA[0]?.length ?? 0;
    const kLimit = Math.min(rankK ?? Math.min(m, n), m, n);

    // 1. Form symmetric Gram matrix G = A^T * A (n x n)
    const ata: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let sum = 0;
        for (let r = 0; r < m; r++) {
          sum += matrixA[r]![i]! * matrixA[r]![j]!;
        }
        ata[i]![j] = sum;
        ata[j]![i] = sum;
      }
    }

    const eig = JacobiSymmetricEigenvaluePcaEngine.solveSymmetricEigen(ata);
    const singularValues = eig.eigenvalues.map((ev) =>
      Number(Math.sqrt(Math.max(0, ev)).toFixed(6))
    );
    const V = eig.eigenvectorsColumns; // n x n (columns are v_j)

    // 2. Compute left singular vectors u_j = (A * v_j) / sigma_j (m x n)
    const U: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      const sigma = singularValues[j]!;
      if (sigma > 1e-9) {
        for (let r = 0; r < m; r++) {
          let av = 0;
          for (let c = 0; c < n; c++) {
            av += matrixA[r]![c]! * V[c]![j]!;
          }
          U[r]![j] = av / sigma;
        }
      }
    }

    // 3. Eckart-Young rank-k approximation A_k = sum_{j=0..k-1} sigma_j * u_j * v_j^T
    const approx: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
    for (let j = 0; j < kLimit; j++) {
      const sigma = singularValues[j]!;
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < n; c++) {
          approx[r]![c]! += sigma * U[r]![j]! * V[c]![j]!;
        }
      }
    }

    // 4. Moore-Penrose Pseudoinverse A^+ = V * Sigma^+ * U^T (n x m)
    const pinv: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(0));
    for (let j = 0; j < n; j++) {
      const sigma = singularValues[j]!;
      if (sigma > 1e-7) {
        const invSigma = 1 / sigma;
        for (let c = 0; c < n; c++) {
          for (let r = 0; r < m; r++) {
            pinv[c]![r]! += invSigma * V[c]![j]! * U[r]![j]!;
          }
        }
      }
    }

    let frobSq = 0;
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < n; c++) {
        const diff = matrixA[r]![c]! - approx[r]![c]!;
        frobSq += diff * diff;
        approx[r]![c] = Number(approx[r]![c]!.toFixed(6));
      }
    }

    return {
      singularValues,
      leftSingularVectorsU: U.map((r) => r.map((v) => Number(v.toFixed(6)))),
      rightSingularVectorsV: V.map((r) => r.map((v) => Number(v.toFixed(6)))),
      rankKApproximationMatrix: approx,
      moorePenrosePseudoinverse: pinv.map((r) => r.map((v) => Number(v.toFixed(6)))),
      frobeniusReconstructionError: Number(Math.sqrt(frobSq).toFixed(6))
    };
  }
}
