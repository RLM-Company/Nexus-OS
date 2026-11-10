export interface OnlineMomentsSummary {
  count: number;
  kahanCompensatedSum: number;
  mean: number;
  sampleVariance: number;
  standardDeviation: number;
  skewness: number;
  excessKurtosis: number;
}

/**
 * Kahan-Babuska Compensated Summation & Pébay / Welford One-Pass Online Higher-Order Moments Tracker.
 * Computes exact streaming Sum, Mean, Variance, Skewness, and Excess Kurtosis in O(1) memory
 * without catastrophic floating-point cancellation.
 */
export class WelfordHigherOrderMomentsTracker {
  private n = 0;
  private kahanSum = 0;
  private kahanCorrectionC = 0;

  private mean = 0;
  private m2 = 0;
  private m3 = 0;
  private m4 = 0;

  public observe(x: number): void {
    if (!Number.isFinite(x)) return;

    // 1. Kahan compensated summation
    const y = x - this.kahanCorrectionC;
    const t = this.kahanSum + y;
    this.kahanCorrectionC = t - this.kahanSum - y;
    this.kahanSum = t;

    // 2. Pébay / Terriberry one-pass central moments M2, M3, M4 update
    const n1 = this.n;
    this.n++;
    const delta = x - this.mean;
    const deltaN = delta / this.n;
    const deltaN2 = deltaN * deltaN;
    const term1 = delta * deltaN * n1;

    this.mean += deltaN;
    this.m4 +=
      term1 * deltaN2 * (this.n * this.n - 3 * this.n + 3) +
      6 * deltaN2 * this.m2 -
      4 * deltaN * this.m3;
    this.m3 += term1 * deltaN * (this.n - 2) - 3 * deltaN * this.m2;
    this.m2 += term1;
  }

  public getSummary(): OnlineMomentsSummary {
    if (this.n === 0) {
      return {
        count: 0,
        kahanCompensatedSum: 0,
        mean: 0,
        sampleVariance: 0,
        standardDeviation: 0,
        skewness: 0,
        excessKurtosis: 0
      };
    }

    const sampleVariance = this.n > 1 ? this.m2 / (this.n - 1) : 0;
    const stdDev = Math.sqrt(sampleVariance);

    const skewness =
      this.m2 > 1e-12 ? (Math.sqrt(this.n) * this.m3) / Math.pow(this.m2, 1.5) : 0;
    const excessKurtosis =
      this.m2 > 1e-12 ? (this.n * this.m4) / (this.m2 * this.m2) - 3.0 : 0;

    return {
      count: this.n,
      kahanCompensatedSum: Number(this.kahanSum.toFixed(8)),
      mean: Number(this.mean.toFixed(6)),
      sampleVariance: Number(sampleVariance.toFixed(6)),
      standardDeviation: Number(stdDev.toFixed(6)),
      skewness: Number(skewness.toFixed(6)),
      excessKurtosis: Number(excessKurtosis.toFixed(6))
    };
  }
}
