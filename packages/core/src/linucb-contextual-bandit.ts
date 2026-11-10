export interface LinUcbArmSelection {
  selectedArmId: string;
  expectedReward: number;
  uncertaintyBonus: number;
  ucbScore: number;
}

/**
 * Disjoint Linear Upper Confidence Bound (LinUCB) Contextual Bandit Router.
 * Selects optimal model/tool arms conditioned on a d-dimensional context feature vector x_t:
 * a_t = argmax_a ( theta_a^T x_t + alpha * sqrt(x_t^T A_a^{-1} x_t) )
 */
export class LinUcbContextualBandit {
  public readonly dimension: number;
  public readonly alphaExploration: number;
  // A_a: d x d ridge covariance matrix per arm
  private readonly matrixA = new Map<string, number[][]>();
  // b_a: d x 1 reward accumulator vector per arm
  private readonly vectorB = new Map<string, number[]>();

  constructor(params: { dimension: number; alphaExploration?: number; armIds?: string[] }) {
    this.dimension = Math.max(1, params.dimension);
    this.alphaExploration = params.alphaExploration ?? 0.6;
    for (const id of params.armIds ?? []) {
      this.registerArm(id);
    }
  }

  public registerArm(armId: string): void {
    if (this.matrixA.has(armId)) return;
    const identity = Array.from({ length: this.dimension }, (_, i) =>
      Array.from({ length: this.dimension }, (__, j) => (i === j ? 1.0 : 0.0))
    );
    this.matrixA.set(armId, identity);
    this.vectorB.set(armId, new Array<number>(this.dimension).fill(0));
  }

  /**
   * Computes matrix inverse A^{-1} using Gauss-Jordan elimination with partial pivoting.
   */
  public static invertMatrix(matrix: number[][]): number[][] {
    const n = matrix.length;
    const aug = matrix.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))
    ]);

    for (let col = 0; col < n; col++) {
      let pivotRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivotRow]![col]!)) {
          pivotRow = r;
        }
      }
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;

      const pivotVal = aug[col]![col]!;
      const safePivot = Math.abs(pivotVal) < 1e-12 ? 1e-12 : pivotVal;
      for (let j = 0; j < 2 * n; j++) {
        aug[col]![j] = aug[col]![j]! / safePivot;
      }

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r]![col]!;
        for (let j = 0; j < 2 * n; j++) {
          aug[r]![j] = aug[r]![j]! - factor * aug[col]![j]!;
        }
      }
    }

    return aug.map((row) => row.slice(n, 2 * n));
  }

  public selectArm(contextVector: number[]): LinUcbArmSelection {
    if (contextVector.length !== this.dimension) {
      throw new Error(`LINUCB_DIMENSION_MISMATCH: expected ${this.dimension}, got ${contextVector.length}`);
    }
    if (this.matrixA.size === 0) {
      throw new Error("LINUCB_NO_ARMS_REGISTERED");
    }

    let bestSelection: LinUcbArmSelection | null = null;

    for (const [armId, matA] of this.matrixA.entries()) {
      const vecB = this.vectorB.get(armId)!;
      const invA = LinUcbContextualBandit.invertMatrix(matA);

      // theta = A^{-1} b
      const theta = new Array<number>(this.dimension).fill(0);
      for (let i = 0; i < this.dimension; i++) {
        let sum = 0;
        for (let j = 0; j < this.dimension; j++) {
          sum += invA[i]![j]! * vecB[j]!;
        }
        theta[i] = sum;
      }

      // expectedReward = theta^T x
      let expectedReward = 0;
      for (let i = 0; i < this.dimension; i++) {
        expectedReward += theta[i]! * contextVector[i]!;
      }

      // quadForm = x^T A^{-1} x
      let quadForm = 0;
      for (let i = 0; i < this.dimension; i++) {
        let rowDot = 0;
        for (let j = 0; j < this.dimension; j++) {
          rowDot += invA[i]![j]! * contextVector[j]!;
        }
        quadForm += contextVector[i]! * rowDot;
      }

      const uncertaintyBonus = this.alphaExploration * Math.sqrt(Math.max(0, quadForm));
      const ucbScore = expectedReward + uncertaintyBonus;

      if (!bestSelection || ucbScore > bestSelection.ucbScore) {
        bestSelection = {
          selectedArmId: armId,
          expectedReward: Number(expectedReward.toFixed(4)),
          uncertaintyBonus: Number(uncertaintyBonus.toFixed(4)),
          ucbScore: Number(ucbScore.toFixed(4))
        };
      }
    }

    return bestSelection!;
  }

  public updateReward(armId: string, contextVector: number[], reward: number): void {
    this.registerArm(armId);
    const matA = this.matrixA.get(armId)!;
    const vecB = this.vectorB.get(armId)!;

    // A_a <- A_a + x x^T; b_a <- b_a + r * x
    for (let i = 0; i < this.dimension; i++) {
      vecB[i] = vecB[i]! + reward * contextVector[i]!;
      for (let j = 0; j < this.dimension; j++) {
        matA[i]![j] = matA[i]![j]! + contextVector[i]! * contextVector[j]!;
      }
    }
  }
}
