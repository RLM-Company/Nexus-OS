import { MahalanobisMultivariateAnomalyDetector } from "./mahalanobis-ewma-covariance-detector.ts";

export interface EqualityQpSolution {
  primalSolutionX: number[];
  lagrangeMultipliersNu: number[];
  optimalObjectiveValue: number;
  kktResidualNorm: number;
}

/**
 * Karush-Kuhn-Tucker (KKT) Equality-Constrained Convex Quadratic Programming (QP) Solver
 * & Projected Simplex Box-Constrained QP Optimizer.
 * Solves:
 *   minimize  (1/2) x^T Q x + c^T x
 *   subject to  A x = b
 * by constructing and solving the exact KKT saddle-point linear system:
 *   [ Q   A^T ] [ x  ] = [ -c ]
 *   [ A    0  ] [ nu ]   [  b ]
 */
export class ActiveSetQuadraticProgramSolver {
  public static solveEqualityConstrainedQp(params: {
    hessianQ: number[][];
    linearCostC: number[];
    equalityMatrixA: number[][];
    equalityRhsB: number[];
  }): EqualityQpSolution {
    const n = params.hessianQ.length;
    const p = params.equalityMatrixA.length;
    const dim = n + p;

    const kktMatrix: number[][] = Array.from({ length: dim }, () =>
      new Array<number>(dim).fill(0)
    );
    const rhs: number[] = new Array<number>(dim).fill(0);

    for (let i = 0; i < n; i++) {
      rhs[i] = -params.linearCostC[i]!;
      for (let j = 0; j < n; j++) {
        kktMatrix[i]![j] = params.hessianQ[i]![j]!;
      }
    }

    for (let k = 0; k < p; k++) {
      rhs[n + k] = params.equalityRhsB[k]!;
      for (let j = 0; j < n; j++) {
        const aVal = params.equalityMatrixA[k]![j]!;
        kktMatrix[n + k]![j] = aVal;
        kktMatrix[j]![n + k] = aVal;
      }
    }

    const invKkt = MahalanobisMultivariateAnomalyDetector.invertMatrix(kktMatrix);
    const sol = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      let s = 0;
      for (let j = 0; j < dim; j++) {
        s += invKkt[i]![j]! * rhs[j]!;
      }
      sol[i] = s;
    }

    const x = sol.slice(0, n);
    const nu = sol.slice(n);

    // Objective (1/2) x^T Q x + c^T x
    let obj = 0;
    for (let i = 0; i < n; i++) {
      obj += params.linearCostC[i]! * x[i]!;
      for (let j = 0; j < n; j++) {
        obj += 0.5 * x[i]! * params.hessianQ[i]![j]! * x[j]!;
      }
    }

    // KKT residual
    let resSq = 0;
    for (let i = 0; i < dim; i++) {
      let lhs = 0;
      for (let j = 0; j < dim; j++) {
        lhs += kktMatrix[i]![j]! * sol[j]!;
      }
      const err = lhs - rhs[i]!;
      resSq += err * err;
    }

    return {
      primalSolutionX: x.map((v) => Number(v.toFixed(6))),
      lagrangeMultipliersNu: nu.map((v) => Number(v.toFixed(6))),
      optimalObjectiveValue: Number(obj.toFixed(6)),
      kktResidualNorm: Number(Math.sqrt(resSq).toFixed(6))
    };
  }
}
