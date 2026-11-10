export interface BottleneckAssignmentResult {
  minMaxBottleneckCost: number;
  rowToColAssignment: number[];
}

/**
 * Linear Bottleneck Assignment Problem (LBAP) Min-Max Solver.
 * Finds a bijection pi: {0..N-1} -> {0..N-1} that minimizes the maximum assigned edge cost:
 *   min_pi max_{0 <= i < N} costMatrix[i][pi(i)]
 * via binary search over the sorted distinct matrix entries combined with bipartite perfect
 * matching feasibility tests on the thresholded subgraph G(tau).
 */
export class LinearBottleneckAssignmentSolver {
  private static findPerfectMatchingAtThreshold(
    costMatrix: number[][],
    thresholdTau: number
  ): number[] | null {
    const n = costMatrix.length;
    const matchColToRow = new Array<number>(n).fill(-1);

    const dfs = (row: number, visitedCols: boolean[]): boolean => {
      for (let col = 0; col < n; col++) {
        if (costMatrix[row]![col]! > thresholdTau || visitedCols[col]) continue;
        visitedCols[col] = true;
        if (matchColToRow[col] === -1 || dfs(matchColToRow[col]!, visitedCols)) {
          matchColToRow[col] = row;
          return true;
        }
      }
      return false;
    };

    for (let r = 0; r < n; r++) {
      const visited = new Array<boolean>(n).fill(false);
      if (!dfs(r, visited)) return null;
    }

    const rowToCol = new Array<number>(n).fill(-1);
    for (let c = 0; c < n; c++) {
      rowToCol[matchColToRow[c]!] = c;
    }
    return rowToCol;
  }

  public static solveMinMaxBottleneck(costMatrix: number[][]): BottleneckAssignmentResult {
    const n = costMatrix.length;
    if (n === 0) {
      return { minMaxBottleneckCost: 0, rowToColAssignment: [] };
    }

    const distinctCostsSet = new Set<number>();
    for (const row of costMatrix) {
      for (const c of row) distinctCostsSet.add(c);
    }
    const sortedCosts = [...distinctCostsSet].sort((a, b) => a - b);

    let lo = 0;
    let hi = sortedCosts.length - 1;
    let bestCost = sortedCosts[hi]!;
    let bestAssignment: number[] = Array.from({ length: n }, (_, i) => i);

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const tau = sortedCosts[mid]!;
      const matching = LinearBottleneckAssignmentSolver.findPerfectMatchingAtThreshold(
        costMatrix,
        tau
      );
      if (matching) {
        bestCost = tau;
        bestAssignment = matching;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return {
      minMaxBottleneckCost: bestCost,
      rowToColAssignment: bestAssignment
    };
  }
}
