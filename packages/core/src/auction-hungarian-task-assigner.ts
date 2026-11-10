export interface AssignmentPair {
  workerIndex: number;
  taskIndex: number;
  cost: number;
}

export interface HungarianAssignmentResult {
  assignments: AssignmentPair[];
  totalMinimumCost: number;
}

/**
 * Exact O(N^3) Kuhn-Munkres (Hungarian) Bipartite Minimum-Cost / Maximum-Utility Task Assignment Engine.
 * Finds the globally optimal 1-to-1 assignment between workers/agents and tasks using dual potentials (u, v)
 * and shortest augmenting paths.
 */
export class HungarianKuhnMunkresAssigner {
  public static solveMinimumCostAssignment(costMatrix: number[][]): HungarianAssignmentResult {
    const nRows = costMatrix.length;
    if (nRows === 0) return { assignments: [], totalMinimumCost: 0 };
    const nCols = costMatrix[0]!.length;
    const n = Math.max(nRows, nCols);

    // Pad rectangular matrix to square n x n with zero dummy costs
    const a: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 0; i < nRows; i++) {
      for (let j = 0; j < nCols; j++) {
        a[i + 1]![j + 1] = costMatrix[i]![j]!;
      }
    }

    const u = new Array<number>(n + 1).fill(0);
    const v = new Array<number>(n + 1).fill(0);
    const p = new Array<number>(n + 1).fill(0); // p[j] = row matched to column j
    const way = new Array<number>(n + 1).fill(0);

    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array<number>(n + 1).fill(Infinity);
      const used = new Array<boolean>(n + 1).fill(false);

      do {
        used[j0] = true;
        const i0 = p[j0]!;
        let delta = Infinity;
        let j1 = 0;

        for (let j = 1; j <= n; j++) {
          if (!used[j]) {
            const cur = a[i0]![j]! - u[i0]! - v[j]!;
            if (cur < minv[j]!) {
              minv[j] = cur;
              way[j] = j0;
            }
            if (minv[j]! < delta) {
              delta = minv[j]!;
              j1 = j;
            }
          }
        }

        for (let j = 0; j <= n; j++) {
          if (used[j]) {
            u[p[j]!] = u[p[j]!]! + delta;
            v[j] = v[j]! - delta;
          } else {
            minv[j] = minv[j]! - delta;
          }
        }
        j0 = j1;
      } while (p[j0] !== 0);

      do {
        const j1 = way[j0]!;
        p[j0] = p[j1]!;
        j0 = j1;
      } while (j0 !== 0);
    }

    const assignments: AssignmentPair[] = [];
    let totalMinimumCost = 0;

    for (let j = 1; j <= nCols; j++) {
      const rowIdx = p[j]! - 1;
      const colIdx = j - 1;
      if (rowIdx >= 0 && rowIdx < nRows) {
        const c = costMatrix[rowIdx]![colIdx]!;
        assignments.push({ workerIndex: rowIdx, taskIndex: colIdx, cost: c });
        totalMinimumCost += c;
      }
    }

    assignments.sort((x, y) => x.workerIndex - y.workerIndex);

    return {
      assignments,
      totalMinimumCost: Number(totalMinimumCost.toFixed(6))
    };
  }
}
