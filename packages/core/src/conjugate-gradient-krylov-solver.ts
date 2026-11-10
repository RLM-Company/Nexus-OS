export interface KrylovPcgResult {
  solutionX: number[];
  residualNorm: number;
  iterationsExecuted: number;
  converged: boolean;
}

/**
 * Hestenes & Stiefel Preconditioned Conjugate Gradient (PCG) Krylov Subspace Solver.
 * Solves Symmetric Positive-Definite (SPD) linear systems A x = b using Jacobi diagonal
 * preconditioning M = diag(A) in O(d * sqrt(kappa)) iterations.
 */
export class ConjugateGradientKrylovLinearSolver {
  public static solveSpdSystem(
    matrixA: number[][],
    vectorB: number[],
    options?: { tolerance?: number; maxIterations?: number }
  ): KrylovPcgResult {
    const n = vectorB.length;
    const tol = options?.tolerance ?? 1e-8;
    const maxIter = options?.maxIterations ?? n * 4;

    const x = new Array<number>(n).fill(0);
    // r = b - A * x = b (since x_0 = 0)
    const r = [...vectorB];

    // Jacobi preconditioner M^{-1}_{ii} = 1 / A_{ii}
    const invDiag = Array.from({ length: n }, (_, i) => {
      const aii = matrixA[i]![i]!;
      return Math.abs(aii) > 1e-12 ? 1.0 / aii : 1.0;
    });

    // z = M^{-1} r
    const z = r.map((ri, i) => invDiag[i]! * ri);
    // p = z
    const p = [...z];

    const dot = (u: number[], v: number[]): number => {
      let s = 0;
      for (let i = 0; i < n; i++) s += u[i]! * v[i]!;
      return s;
    };

    let rzOld = dot(r, z);
    let converged = false;
    let iter = 0;
    let resNorm = Math.sqrt(dot(r, r));

    if (resNorm <= tol) {
      return {
        solutionX: x,
        residualNorm: resNorm,
        iterationsExecuted: 0,
        converged: true
      };
    }

    for (; iter < maxIter; iter++) {
      // Ap = A * p
      const Ap = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        let rowSum = 0;
        for (let j = 0; j < n; j++) {
          rowSum += matrixA[i]![j]! * p[j]!;
        }
        Ap[i] = rowSum;
      }

      const pAp = dot(p, Ap);
      if (Math.abs(pAp) <= 1e-18) break;

      const alpha = rzOld / pAp;
      for (let i = 0; i < n; i++) {
        x[i] = x[i]! + alpha * p[i]!;
        r[i] = r[i]! - alpha * Ap[i]!;
      }

      resNorm = Math.sqrt(dot(r, r));
      if (resNorm <= tol) {
        converged = true;
        iter++;
        break;
      }

      for (let i = 0; i < n; i++) {
        z[i] = invDiag[i]! * r[i]!;
      }

      const rzNew = dot(r, z);
      const beta = rzNew / Math.max(1e-18, rzOld);
      for (let i = 0; i < n; i++) {
        p[i] = z[i]! + beta * p[i]!;
      }
      rzOld = rzNew;
    }

    return {
      solutionX: x.map((v) => Number(v.toFixed(6))),
      residualNorm: Number(resNorm.toFixed(9)),
      iterationsExecuted: iter,
      converged
    };
  }
}
