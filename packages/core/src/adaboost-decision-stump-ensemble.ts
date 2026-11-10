export interface DecisionStumpWeakLearner {
  featureIndex: number;
  threshold: number;
  polarity: 1 | -1; // +1 if x[feat] >= threshold predicts +1, -1 otherwise
  alphaWeight: number;
}

/**
 * Freund & Schapire's Discrete AdaBoost Ensemble Classifier over Decision Stumps.
 * Combines T weak axis-aligned threshold learners into a strong margin classifier
 * H(x) = sign(sum_{t=1}^T alpha_t h_t(x)).
 */
export class FreundSchapireAdaBoostClassifier {
  public readonly stumps: DecisionStumpWeakLearner[] = [];

  private static evaluateStump(
    x: number[],
    featureIndex: number,
    threshold: number,
    polarity: 1 | -1
  ): 1 | -1 {
    const val = x[featureIndex] ?? 0;
    const raw = val >= threshold ? 1 : -1;
    return (raw * polarity) as 1 | -1;
  }

  public fit(
    samplesX: number[][],
    labelsY: Array<1 | -1>,
    numRounds = 12
  ): void {
    const n = samplesX.length;
    if (n === 0) return;
    const dim = samplesX[0]!.length;

    const weights = new Float64Array(n).fill(1.0 / n);
    this.stumps.length = 0;

    for (let round = 0; round < numRounds; round++) {
      let bestError = Infinity;
      let bestFeat = 0;
      let bestThresh = 0;
      let bestPol: 1 | -1 = 1;

      for (let f = 0; f < dim; f++) {
        const uniqueVals = Array.from(new Set(samplesX.map((x) => x[f]!))).sort(
          (a, b) => a - b
        );
        for (const thresh of uniqueVals) {
          for (const pol of [1, -1] as const) {
            let err = 0;
            for (let i = 0; i < n; i++) {
              const pred = FreundSchapireAdaBoostClassifier.evaluateStump(
                samplesX[i]!,
                f,
                thresh,
                pol
              );
              if (pred !== labelsY[i]) {
                err += weights[i]!;
              }
            }
            if (err < bestError) {
              bestError = err;
              bestFeat = f;
              bestThresh = thresh;
              bestPol = pol;
            }
          }
        }
      }

      const clampedErr = Math.min(1 - 1e-9, Math.max(1e-9, bestError));
      const alpha = 0.5 * Math.log((1.0 - clampedErr) / clampedErr);

      this.stumps.push({
        featureIndex: bestFeat,
        threshold: bestThresh,
        polarity: bestPol,
        alphaWeight: Number(alpha.toFixed(6))
      });

      // Reweight and normalize sample distribution
      let sumW = 0;
      for (let i = 0; i < n; i++) {
        const pred = FreundSchapireAdaBoostClassifier.evaluateStump(
          samplesX[i]!,
          bestFeat,
          bestThresh,
          bestPol
        );
        weights[i] = weights[i]! * Math.exp(-alpha * labelsY[i]! * pred);
        sumW += weights[i]!;
      }
      for (let i = 0; i < n; i++) {
        weights[i] = weights[i]! / Math.max(1e-12, sumW);
      }

      if (bestError <= 1e-7) break;
    }
  }

  public predict(x: number[]): { label: 1 | -1; marginScore: number } {
    let margin = 0;
    for (const s of this.stumps) {
      margin +=
        s.alphaWeight *
        FreundSchapireAdaBoostClassifier.evaluateStump(
          x,
          s.featureIndex,
          s.threshold,
          s.polarity
        );
    }
    return {
      label: margin >= 0 ? 1 : -1,
      marginScore: Number(margin.toFixed(6))
    };
  }
}
