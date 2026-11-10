export interface KalmanCusumStepReport {
  step: number;
  rawMeasurement: number;
  kalmanEstimate: number;
  kalmanGain: number;
  posteriorErrorCovariance: number;
  cusumPos: number;
  cusumNeg: number;
  driftDetected: boolean;
  driftDirection: "none" | "upward_spike" | "downward_drop";
}

/**
 * 1D Linear-Gaussian Kalman Filter + Page's Two-Sided CUSUM Sequential Change-Point Detector.
 * Filters noisy provider latency/token-rate telemetry and triggers immediate alerts on structural regime shifts.
 */
export class KalmanCusumDriftDetector {
  private stateEstimate: number;
  private errorCovariance: number;
  private readonly processNoiseQ: number;
  private readonly measurementNoiseR: number;
  private readonly targetBaseline: number;
  private readonly slackAllowanceK: number;
  private readonly decisionThresholdH: number;
  private cusumPos = 0;
  private cusumNeg = 0;
  private stepCount = 0;

  constructor(options: {
    initialBaseline: number;
    processNoiseQ?: number;
    measurementNoiseR?: number;
    slackAllowanceK?: number;
    decisionThresholdH?: number;
  }) {
    this.stateEstimate = options.initialBaseline;
    this.targetBaseline = options.initialBaseline;
    this.errorCovariance = 1.0;
    this.processNoiseQ = options.processNoiseQ ?? 0.05;
    this.measurementNoiseR = options.measurementNoiseR ?? 4.0;
    this.slackAllowanceK = options.slackAllowanceK ?? 5.0;
    this.decisionThresholdH = options.decisionThresholdH ?? 25.0;
  }

  public observe(measurement: number): KalmanCusumStepReport {
    this.stepCount++;

    // 1. Kalman Predict Step
    const predictedState = this.stateEstimate;
    const predictedCovariance = this.errorCovariance + this.processNoiseQ;

    // 2. Kalman Update Step
    const kalmanGain = predictedCovariance / (predictedCovariance + this.measurementNoiseR);
    this.stateEstimate = predictedState + kalmanGain * (measurement - predictedState);
    this.errorCovariance = (1 - kalmanGain) * predictedCovariance;

    // 3. Page's Two-Sided CUSUM Update on raw measurement vs baseline
    const deviation = measurement - this.targetBaseline;
    this.cusumPos = Math.max(0, this.cusumPos + deviation - this.slackAllowanceK);
    this.cusumNeg = Math.max(0, this.cusumNeg - deviation - this.slackAllowanceK);

    let driftDirection: "none" | "upward_spike" | "downward_drop" = "none";
    if (this.cusumPos >= this.decisionThresholdH) {
      driftDirection = "upward_spike";
    } else if (this.cusumNeg >= this.decisionThresholdH) {
      driftDirection = "downward_drop";
    }

    return {
      step: this.stepCount,
      rawMeasurement: measurement,
      kalmanEstimate: Number(this.stateEstimate.toFixed(4)),
      kalmanGain: Number(kalmanGain.toFixed(4)),
      posteriorErrorCovariance: Number(this.errorCovariance.toFixed(4)),
      cusumPos: Number(this.cusumPos.toFixed(4)),
      cusumNeg: Number(this.cusumNeg.toFixed(4)),
      driftDetected: driftDirection !== "none",
      driftDirection
    };
  }

  public resetCusumAccumulator(): void {
    this.cusumPos = 0;
    this.cusumNeg = 0;
  }
}
