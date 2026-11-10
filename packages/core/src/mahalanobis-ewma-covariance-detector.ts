export interface MahalanobisEvaluation {
  mahalanobisDistance: number;
  mahalanobisDistanceSquared: number;
  isAnomalyAtChiSquareThreshold: boolean;
}

/**
 * Prasanta Chandra Mahalanobis Multivariate Covariance & Precision Matrix Anomaly Detector.
 * Estimates the empirical mean vector mu and regularized covariance matrix Sigma = Cov(X) + lambda I,
 * inverts Sigma via Gauss-Jordan pivoting to obtain the precision matrix Omega = Sigma^{-1},
 * and evaluates D_M(x) = sqrt((x - mu)^T Sigma^{-1} (x - mu)).
 */
export class MahalanobisMultivariateAnomalyDetector {
  private readonly meanVector: number[];
  private readonly precisionMatrix: number[][];

  public constructor(samples: number[][], ridgeLambda: number = 1e-4) {
    const m = samples.length;
    const d = samples[0]?.length ?? 0;
    this.meanVector = new Array<number>(d).fill(0);

    for (const s of samples) {
      for (let j = 0; j < d; j++) this.meanVector[j]! += s[j]!;
    }
    for (let j = 0; j < d; j++) this.meanVector[j]! /= Math.max(1, m);

    const cov: number[][] = Array.from({ length: d }, (_, i) =>
      Array.from({ length: d }, (__, j) => (i === j ? ridgeLambda : 0))
    );
    const denom = Math.max(1, m - 1);
    for (const s of samples) {
      for (let i = 0; i < d; i++) {
        const di = s[i]! - this.meanVector[i]!;
        for (let j = 0; j < d; j++) {
          const dj = s[j]! - this.meanVector[j]!;
          cov[i]![j]! += (di * dj) / denom;
        }
      }
    }

    this.precisionMatrix = MahalanobisMultivariateAnomalyDetector.invertMatrix(cov);
  }

  public static invertMatrix(matrix: number[][]): number[][] {
    const n = matrix.length;
    const aug: number[][] = matrix.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
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
      const invPivot = Math.abs(pivotVal) > 1e-12 ? 1 / pivotVal : 1;
      for (let j = 0; j < 2 * n; j++) {
        aug[col]![j]! *= invPivot;
      }

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r]![col]!;
        for (let j = 0; j < 2 * n; j++) {
          aug[r]![j]! -= factor * aug[col]![j]!;
        }
      }
    }

    return aug.map((row) => row.slice(n));
  }

  public evaluateSample(
    point: number[],
    chiSquareThresholdSquared: number = 9.21
  ): MahalanobisEvaluation {
    const d = this.meanVector.length;
    const diff = point.map((v, i) => v - this.meanVector[i]!);

    let dSq = 0;
    for (let i = 0; i < d; i++) {
      let rowDot = 0;
      for (let j = 0; j < d; j++) {
        rowDot += this.precisionMatrix[i]![j]! * diff[j]!;
      }
      dSq += diff[i]! * rowDot;
    }
    dSq = Math.max(0, dSq);

    return {
      mahalanobisDistance: Number(Math.sqrt(dSq).toFixed(6)),
      mahalanobisDistanceSquared: Number(dSq.toFixed(6)),
      isAnomalyAtChiSquareThreshold: dSq > chiSquareThresholdSquared
    };
  }
}
