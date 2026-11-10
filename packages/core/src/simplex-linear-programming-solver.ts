export interface LinearProgramSolution {
  status: "OPTIMAL" | "UNBOUNDED";
  optimalObjectiveValue: number;
  primalVariables: number[];
  dualShadowPrices: number[];
  pivotsExecuted: number;
}

/**
 * Dantzig Primal Simplex Tableau Linear Programming (LP) Solver.
 * Maximizes c^T x subject to A x <= b, x >= 0 (with b >= 0) using slack variables
 * and extracts both optimal primal decision variables and dual shadow prices.
 */
export class DantzigSimplexLinearProgramSolver {
  public static solveMaximization(params: {
    objectiveCoefficientsC: number[]; // length n
    constraintMatrixA: number[][]; // m x n
    constraintRhsB: number[]; // length m (non-negative)
    maxPivots?: number;
  }): LinearProgramSolution {
    const m = params.constraintMatrixA.length;
    const n = params.objectiveCoefficientsC.length;
    const totalCols = n + m + 1; // n decision vars + m slack vars + 1 RHS column

    // Tableau has m + 1 rows: rows 0..m-1 are constraints, row m is objective (-c)
    const tab: number[][] = Array.from(
      { length: m + 1 },
      () => new Array<number>(totalCols).fill(0)
    );

    const basis = new Array<number>(m).fill(0);

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        tab[i]![j] = params.constraintMatrixA[i]![j]!;
      }
      tab[i]![n + i] = 1.0; // Slack variable s_i
      tab[i]![totalCols - 1] = params.constraintRhsB[i]!;
      basis[i] = n + i;
    }

    for (let j = 0; j < n; j++) {
      tab[m]![j] = -params.objectiveCoefficientsC[j]!;
    }

    const maxPivots = params.maxPivots ?? 200;
    let pivotsExecuted = 0;

    while (pivotsExecuted < maxPivots) {
      // Bland's / Dantzig entering column: most negative reduced cost in objective row m
      let enterCol = -1;
      let minReducedCost = -1e-9;
      for (let j = 0; j < n + m; j++) {
        if (tab[m]![j]! < minReducedCost) {
          minReducedCost = tab[m]![j]!;
          enterCol = j;
        }
      }

      if (enterCol === -1) {
        break; // Optimal reached!
      }

      // Minimum ratio test for leaving row
      let leaveRow = -1;
      let minRatio = Infinity;
      for (let i = 0; i < m; i++) {
        const aij = tab[i]![enterCol]!;
        if (aij > 1e-9) {
          const ratio = tab[i]![totalCols - 1]! / aij;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = i;
          }
        }
      }

      if (leaveRow === -1) {
        return {
          status: "UNBOUNDED",
          optimalObjectiveValue: Infinity,
          primalVariables: new Array<number>(n).fill(0),
          dualShadowPrices: new Array<number>(m).fill(0),
          pivotsExecuted
        };
      }

      // Pivot on (leaveRow, enterCol)
      const pivotVal = tab[leaveRow]![enterCol]!;
      for (let j = 0; j < totalCols; j++) {
        tab[leaveRow]![j] = tab[leaveRow]![j]! / pivotVal;
      }

      for (let i = 0; i <= m; i++) {
        if (i === leaveRow) continue;
        const factor = tab[i]![enterCol]!;
        if (Math.abs(factor) <= 1e-12) continue;
        for (let j = 0; j < totalCols; j++) {
          tab[i]![j] = tab[i]![j]! - factor * tab[leaveRow]![j]!;
        }
      }

      basis[leaveRow] = enterCol;
      pivotsExecuted++;
    }

    const primalVariables = new Array<number>(n).fill(0);
    for (let i = 0; i < m; i++) {
      const bCol = basis[i]!;
      if (bCol < n) {
        primalVariables[bCol] = Number(tab[i]![totalCols - 1]!.toFixed(6));
      }
    }

    const dualShadowPrices = Array.from({ length: m }, (_, i) =>
      Number(tab[m]![n + i]!.toFixed(6))
    );

    return {
      status: "OPTIMAL",
      optimalObjectiveValue: Number(tab[m]![totalCols - 1]!.toFixed(6)),
      primalVariables,
      dualShadowPrices,
      pivotsExecuted
    };
  }
}
