import { LinUcbContextualBandit } from "./linucb-contextual-bandit.ts";

export interface GpPosteriorPrediction {
  candidatePoint: number[];
  mean: number;
  stdDev: number;
  ucbAcquisitionScore: number;
  expectedImprovement: number;
}

/**
 * Gaussian Process (GP) Regression & Bayesian Optimization Engine with RBF Kernel.
 * Computes exact non-parametric posterior mean mu(x) and epistemic uncertainty sigma(x)
 * over observed evaluations and ranks candidates via GP-UCB and Expected Improvement (EI).
 */
export class GaussianProcessBayesianOptimizer {
  public readonly lengthScaleL: number;
  public readonly signalVarianceSigmaF2: number;
  public readonly noiseVarianceSigmaN2: number;
  public readonly betaUcb: number;

  private readonly observedX: number[][] = [];
  private readonly observedY: number[] = [];

  constructor(params?: {
    lengthScaleL?: number;
    signalVarianceSigmaF2?: number;
    noiseVarianceSigmaN2?: number;
    betaUcb?: number;
  }) {
    this.lengthScaleL = Math.max(1e-3, params?.lengthScaleL ?? 1.0);
    this.signalVarianceSigmaF2 = Math.max(1e-4, params?.signalVarianceSigmaF2 ?? 1.0);
    this.noiseVarianceSigmaN2 = Math.max(1e-6, params?.noiseVarianceSigmaN2 ?? 1e-3);
    this.betaUcb = params?.betaUcb ?? 1.96;
  }

  public rbfKernel(a: number[], b: number[]): number {
    const d = Math.min(a.length, b.length);
    let sqDist = 0;
    for (let i = 0; i < d; i++) {
      const diff = a[i]! - b[i]!;
      sqDist += diff * diff;
    }
    return (
      this.signalVarianceSigmaF2 *
      Math.exp(-sqDist / (2.0 * this.lengthScaleL * this.lengthScaleL))
    );
  }

  public recordObservation(x: number[], y: number): void {
    this.observedX.push([...x]);
    this.observedY.push(y);
  }

  private static standardNormalPdf(z: number): number {
    return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  }

  private static standardNormalCdf(z: number): number {
    // Abramowitz & Stegun 7.1.26 error function approximation
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + 0.3275911 * x);
    const erf =
      1.0 -
      (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
        0.254829592) *
        t) *
        Math.exp(-x * x);
    return 0.5 * (1.0 + sign * erf);
  }

  public evaluateCandidates(candidates: number[][]): GpPosteriorPrediction[] {
    const n = this.observedX.length;
    if (n === 0) {
      const std = Math.sqrt(this.signalVarianceSigmaF2);
      return candidates.map((c) => ({
        candidatePoint: c,
        mean: 0,
        stdDev: Number(std.toFixed(6)),
        ucbAcquisitionScore: Number((this.betaUcb * std).toFixed(6)),
        expectedImprovement: Number((0.3989 * std).toFixed(6))
      }));
    }

    // Build covariance matrix K + sigma_n^2 * I
    const K: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => {
        const kVal = this.rbfKernel(this.observedX[i]!, this.observedX[j]!);
        return i === j ? kVal + this.noiseVarianceSigmaN2 : kVal;
      })
    );

    const invK = LinUcbContextualBandit.invertMatrix(K);
    // alpha = K^{-1} y
    const alpha = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += invK[i]![j]! * this.observedY[j]!;
      }
      alpha[i] = sum;
    }

    const bestObservedY = Math.max(...this.observedY);

    return candidates
      .map((xStar) => {
        const kStar = this.observedX.map((xi) => this.rbfKernel(xStar, xi));
        let mean = 0;
        for (let i = 0; i < n; i++) {
          mean += kStar[i]! * alpha[i]!;
        }

        let quad = 0;
        for (let i = 0; i < n; i++) {
          let rowSum = 0;
          for (let j = 0; j < n; j++) {
            rowSum += invK[i]![j]! * kStar[j]!;
          }
          quad += kStar[i]! * rowSum;
        }

        const kStarStar = this.rbfKernel(xStar, xStar);
        const variance = Math.max(1e-9, kStarStar - quad);
        const stdDev = Math.sqrt(variance);
        const ucb = mean + this.betaUcb * stdDev;

        const z = (mean - bestObservedY) / stdDev;
        const ei =
          (mean - bestObservedY) * GaussianProcessBayesianOptimizer.standardNormalCdf(z) +
          stdDev * GaussianProcessBayesianOptimizer.standardNormalPdf(z);

        return {
          candidatePoint: xStar,
          mean: Number(mean.toFixed(6)),
          stdDev: Number(stdDev.toFixed(6)),
          ucbAcquisitionScore: Number(ucb.toFixed(6)),
          expectedImprovement: Number(Math.max(0, ei).toFixed(6))
        };
      })
      .sort((a, b) => b.ucbAcquisitionScore - a.ucbAcquisitionScore);
  }
}
