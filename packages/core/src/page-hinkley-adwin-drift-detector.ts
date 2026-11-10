export interface PageHinkleyDriftObservationResult {
  stepIndex: number;
  runningMean: number;
  cumulativeDeviationUt: number;
  minCumulativeDeviationMt: number;
  pageHinkleyStatisticPh: number;
  driftDetected: boolean;
}

/**
 * Sequential Analysis Page-Hinkley Test (PHT) Online Concept-Drift Detector.
 * Detects abrupt or gradual upward shifts in error/latency streams by tracking
 * U_T = sum_{t=1}^T (x_t - mean_T - delta) and alarming when U_T - min(U_t) > lambda.
 */
export class PageHinkleyConceptDriftDetector {
  public readonly magnitudeDelta: number;
  public readonly thresholdLambda: number;

  private count = 0;
  private runningMean = 0;
  private cumulativeUt = 0;
  private minUt = 0;

  constructor(params?: { magnitudeDelta?: number; thresholdLambda?: number }) {
    this.magnitudeDelta = params?.magnitudeDelta ?? 0.05;
    this.thresholdLambda = params?.thresholdLambda ?? 15.0;
  }

  public observe(value: number): PageHinkleyDriftObservationResult {
    this.count++;
    this.runningMean += (value - this.runningMean) / this.count;
    this.cumulativeUt += value - this.runningMean - this.magnitudeDelta;
    this.minUt = Math.min(this.minUt, this.cumulativeUt);

    const phStat = this.cumulativeUt - this.minUt;
    const driftDetected = phStat > this.thresholdLambda;

    return {
      stepIndex: this.count,
      runningMean: Number(this.runningMean.toFixed(6)),
      cumulativeDeviationUt: Number(this.cumulativeUt.toFixed(6)),
      minCumulativeDeviationMt: Number(this.minUt.toFixed(6)),
      pageHinkleyStatisticPh: Number(phStat.toFixed(6)),
      driftDetected
    };
  }

  public reset(): void {
    this.count = 0;
    this.runningMean = 0;
    this.cumulativeUt = 0;
    this.minUt = 0;
  }
}
