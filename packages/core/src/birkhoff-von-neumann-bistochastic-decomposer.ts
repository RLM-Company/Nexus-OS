export interface PermutationScheduleTerm {
  weightTheta: number;
  rowToColAssignment: number[];
}

export interface BirkhoffDecompositionResult {
  balancedBistochasticMatrix: number[][];
  terms: PermutationScheduleTerm[];
  maxReconstructionErrorLInf: number;
}

/**
 * Birkhoff-von Neumann Doubly Stochastic Matrix Decomposition Engine.
 * Balances any non-negative matrix into a doubly stochastic matrix via Sinkhorn-Knopp
 * alternating row/column normalization, then iteratively extracts maximum-bottleneck
 * bipartite matchings (permutations P_k with weights theta_k) so S ≈ sum_k theta_k P_k.
 */
export class BirkhoffVonNeumannDecompositionEngine {
  public static balanceSinkhornKnopp(
    matrix: number[][],
    iterations: number = 40
  ): number[][] {
    const n = matrix.length;
    const S = matrix.map((row) => row.map((v) => Math.max(v, 1e-12)));

    for (let it = 0; it < iterations; it++) {
      // Normalize rows
      for (let i = 0; i < n; i++) {
        const rowSum = S[i]!.reduce((a, b) => a + b, 0);
        if (rowSum > 0) {
          for (let j = 0; j < n; j++) S[i]![j]! /= rowSum;
        }
      }
      // Normalize cols
      for (let j = 0; j < n; j++) {
        let colSum = 0;
        for (let i = 0; i < n; i++) colSum += S[i]![j]!;
        if (colSum > 0) {
          for (let i = 0; i < n; i++) S[i]![j]! /= colSum;
        }
      }
    }
    return S;
  }

  private static findPerfectMatchingOnSupport(residual: number[][], eps: number): number[] | null {
    const n = residual.length;
    const matchColToRow = new Array<number>(n).fill(-1);

    const dfs = (row: number, visitedCols: boolean[]): boolean => {
      // Try columns in descending order of residual weight to maximize bottleneck
      const cols = Array.from({ length: n }, (_, c) => c).sort(
        (a, b) => residual[row]![b]! - residual[row]![a]!
      );
      for (const col of cols) {
        if (residual[row]![col]! <= eps || visitedCols[col]) continue;
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

  public static decomposeDoublyStochastic(
    inputMatrix: number[][],
    options?: { balanceFirst?: boolean; maxTerms?: number; tolerance?: number }
  ): BirkhoffDecompositionResult {
    const n = inputMatrix.length;
    const tol = options?.tolerance ?? 1e-7;
    const maxTerms = options?.maxTerms ?? n * n - n + 2;

    const balanced =
      options?.balanceFirst === false
        ? inputMatrix.map((r) => [...r])
        : BirkhoffVonNeumannDecompositionEngine.balanceSinkhornKnopp(inputMatrix);

    const residual = balanced.map((r) => [...r]);
    const terms: PermutationScheduleTerm[] = [];

    for (let step = 0; step < maxTerms; step++) {
      const matching = BirkhoffVonNeumannDecompositionEngine.findPerfectMatchingOnSupport(
        residual,
        tol
      );
      if (!matching) break;

      let theta = Infinity;
      for (let r = 0; r < n; r++) {
        const c = matching[r]!;
        theta = Math.min(theta, residual[r]![c]!);
      }
      if (theta <= tol || !Number.isFinite(theta)) break;

      for (let r = 0; r < n; r++) {
        const c = matching[r]!;
        residual[r]![c] = Math.max(0, residual[r]![c]! - theta);
      }

      terms.push({
        weightTheta: Number(theta.toFixed(6)),
        rowToColAssignment: matching
      });
    }

    let maxErr = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let reconstructed = 0;
        for (const t of terms) {
          if (t.rowToColAssignment[i] === j) {
            reconstructed += t.weightTheta;
          }
        }
        maxErr = Math.max(maxErr, Math.abs(balanced[i]![j]! - reconstructed));
      }
    }

    return {
      balancedBistochasticMatrix: balanced,
      terms,
      maxReconstructionErrorLInf: Number(maxErr.toFixed(6))
    };
  }
}
