export interface CalibrationObservation {
  predictedConfidence: number; // [0.01 .. 0.99]
  actualSuccess: boolean; // true = 1, false = 0
}

export interface CalibrationMetricsReport {
  sampleCount: number;
  brierScore: number; // Lower is better (0.0 = perfect, 0.25 = random coin flip)
  expectedCalibrationError: number; // ECE across 10 probability bins
  optimalTemperatureScale: number; // T > 1 dampens overconfidence, T < 1 sharpens underconfidence
}

/**
 * Bayesian Epistemic Confidence Calibrator & Brier Score / ECE Auditor.
 * Corrects LLM overconfidence via temperature-scaled logit calibration:
 * p_calibrated = sigmoid(logit(p_raw) / T_optimal)
 */
export class BayesianConfidenceCalibrator {
  private readonly history: CalibrationObservation[] = [];

  public recordOutcome(predictedConfidence: number, actualSuccess: boolean): void {
    const p = Math.min(0.99, Math.max(0.01, predictedConfidence));
    this.history.push({ predictedConfidence: p, actualSuccess });
  }

  public static logit(p: number): number {
    const clamped = Math.min(0.999, Math.max(0.001, p));
    return Math.log(clamped / (1 - clamped));
  }

  public static sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-z));
  }

  public static calibrateProbability(rawConfidence: number, temperatureScale: number): number {
    const t = Math.max(0.2, Math.min(5.0, temperatureScale));
    const z = BayesianConfidenceCalibrator.logit(rawConfidence) / t;
    return Number(BayesianConfidenceCalibrator.sigmoid(z).toFixed(4));
  }

  /**
   * Computes Brier Score, 10-bin Expected Calibration Error (ECE),
   * and finds the optimal Platt/Temperature scaling parameter T via grid search minimizing NLL/Brier.
   */
  public evaluateCalibration(): CalibrationMetricsReport {
    const n = this.history.length;
    if (n === 0) {
      return {
        sampleCount: 0,
        brierScore: 0,
        expectedCalibrationError: 0,
        optimalTemperatureScale: 1.0
      };
    }

    let brierSum = 0;
    const bins = Array.from({ length: 10 }, () => ({
      count: 0,
      confSum: 0,
      accSum: 0
    }));

    for (const obs of this.history) {
      const y = obs.actualSuccess ? 1 : 0;
      const diff = obs.predictedConfidence - y;
      brierSum += diff * diff;

      const binIdx = Math.min(9, Math.floor(obs.predictedConfidence * 10));
      const b = bins[binIdx]!;
      b.count++;
      b.confSum += obs.predictedConfidence;
      b.accSum += y;
    }

    let ece = 0;
    for (const b of bins) {
      if (b.count > 0) {
        const avgConf = b.confSum / b.count;
        const avgAcc = b.accSum / b.count;
        ece += (b.count / n) * Math.abs(avgConf - avgAcc);
      }
    }

    // Grid search for optimal temperature scaling T in [0.5 .. 3.0] minimizing Brier score
    let bestT = 1.0;
    let bestScaledBrier = Infinity;
    for (let tStep = 5; tStep <= 30; tStep++) {
      const candidateT = tStep / 10;
      let candidateBrier = 0;
      for (const obs of this.history) {
        const y = obs.actualSuccess ? 1 : 0;
        const calP = BayesianConfidenceCalibrator.calibrateProbability(
          obs.predictedConfidence,
          candidateT
        );
        candidateBrier += (calP - y) * (calP - y);
      }
      if (candidateBrier < bestScaledBrier) {
        bestScaledBrier = candidateBrier;
        bestT = candidateT;
      }
    }

    return {
      sampleCount: n,
      brierScore: Number((brierSum / n).toFixed(4)),
      expectedCalibrationError: Number(ece.toFixed(4)),
      optimalTemperatureScale: bestT
    };
  }

  public calibrateNewPrediction(rawConfidence: number): number {
    const report = this.evaluateCalibration();
    return BayesianConfidenceCalibrator.calibrateProbability(
      rawConfidence,
      report.optimalTemperatureScale
    );
  }
}
