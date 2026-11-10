export interface DbmConsistencyReport {
  consistent: boolean;
  clockNames: string[];
  matrixBounds: number[][];
  minDifferenceBetween: (clockA: string, clockB: string) => number;
  maxDifferenceBetween: (clockA: string, clockB: string) => number;
}

/**
 * Dill / Alur-Dill Difference-Bound Matrix (DBM) Clock-Zone Verifier for Real-Time Timed Automata.
 * Represents convex clock zones over clocks (x_0 = 0, x_1, ..., x_k) as pairwise difference bounds:
 *   x_i - x_j <= M[i][j]
 * Canonicalizes zones via Floyd-Warshall closure and detects unsatisfiable timing deadlocks (M[i][i] < 0).
 */
export class DifferenceBoundMatrixTimedVerifier {
  public readonly clockNames: string[]; // index 0 is always "0" (reference clock)
  private readonly indexByClock = new Map<string, number>();
  private readonly m: number[][];

  constructor(userClocks: string[]) {
    this.clockNames = ["0", ...userClocks];
    this.clockNames.forEach((name, idx) => this.indexByClock.set(name, idx));
    const n = this.clockNames.length;

    // Initialize to x_i >= 0 (i.e. x_0 - x_i <= 0) and x_i - x_j <= 0 initially (all clocks start at 0)
    this.m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  }

  private idx(clock: string): number {
    const i = this.indexByClock.get(clock);
    if (i === undefined) {
      throw new Error(`UNKNOWN_DBM_CLOCK: ${clock}`);
    }
    return i;
  }

  /**
   * Elapses time upward (`up` operator): removes upper bounds on all clocks `x_i - x_0 <= +Infinity`
   * while preserving inter-clock differences `x_i - x_j` and non-negativity `x_0 - x_i <= 0`.
   */
  public elapseTimeUp(): void {
    const n = this.clockNames.length;
    for (let i = 1; i < n; i++) {
      this.m[i]![0] = Infinity;
    }
  }

  /**
   * Adds constraint `clockA - clockB <= maxDiff` (use clockB = "0" for `clockA <= maxDiff`,
   * or clockA = "0" and maxDiff = -L for `clockB >= L`).
   */
  public addConstraint(clockA: string, clockB: string, maxDiff: number): boolean {
    const i = this.idx(clockA);
    const j = this.idx(clockB);
    if (maxDiff < this.m[i]![j]!) {
      this.m[i]![j] = maxDiff;
    }
    return this.canonicalize();
  }

  /**
   * Resets `clock` to 0 (`x_k := 0`) and updates differences relative to all other clocks.
   */
  public resetClockToZero(clock: string): void {
    const k = this.idx(clock);
    const n = this.clockNames.length;
    for (let i = 0; i < n; i++) {
      if (i === k) {
        this.m[k]![k] = 0;
      } else {
        this.m[k]![i] = this.m[0]![i]!;
        this.m[i]![k] = this.m[i]![0]!;
      }
    }
  }

  /**
   * Floyd-Warshall canonical closure over the DBM. Returns false if the zone is empty (negative cycle).
   */
  public canonicalize(): boolean {
    const n = this.clockNames.length;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        if (this.m[i]![k] === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (this.m[k]![j] === Infinity) continue;
          const sum = this.m[i]![k]! + this.m[k]![j]!;
          if (sum < this.m[i]![j]!) {
            this.m[i]![j] = sum;
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (this.m[i]![i]! < 0) {
        return false;
      }
    }
    return true;
  }

  public inspectZone(): DbmConsistencyReport {
    const consistent = this.canonicalize();
    return {
      consistent,
      clockNames: [...this.clockNames],
      matrixBounds: this.m.map((row) => [...row]),
      minDifferenceBetween: (clockA, clockB) => {
        // x_A - x_B >= -M[B][A]
        const i = this.idx(clockA);
        const j = this.idx(clockB);
        return -this.m[j]![i]!;
      },
      maxDifferenceBetween: (clockA, clockB) => {
        // x_A - x_B <= M[A][B]
        const i = this.idx(clockA);
        const j = this.idx(clockB);
        return this.m[i]![j]!;
      }
    };
  }
}
