export interface SmootherAnalysisResult {
  savitzkyGolaySmoothed: number[];
  firstDerivativeVelocity: number[];
  rtsKalmanSmoothed: number[];
}

/**
 * Savitzky-Golay 5-Point Quadratic/Cubic Least-Squares Polynomial Filter &
 * Rauch-Tung-Striebel (RTS) Forward-Backward Fixed-Interval Kalman Smoother.
 */
export class SavitzkyGolayAndRtsSmoother {
  /**
   * Applies 5-point Savitzky-Golay quadratic smoothing coefficients [-3, 12, 17, 12, -3] / 35
   * and 5-point first derivative coefficients [-2, -1, 0, 1, 2] / 10, plus RTS two-pass Kalman smoothing.
   */
  public static smoothAndDifferentiate(
    series: number[],
    options?: { processNoiseQ?: number; measurementNoiseR?: number }
  ): SmootherAnalysisResult {
    const n = series.length;
    if (n === 0) {
      return {
        savitzkyGolaySmoothed: [],
        firstDerivativeVelocity: [],
        rtsKalmanSmoothed: []
      };
    }

    const sgSmoothed = new Array<number>(n);
    const velocity = new Array<number>(n);

    const getClamped = (idx: number) => series[Math.min(n - 1, Math.max(0, idx))]!;

    for (let i = 0; i < n; i++) {
      const yM2 = getClamped(i - 2);
      const yM1 = getClamped(i - 1);
      const y0 = getClamped(i);
      const yP1 = getClamped(i + 1);
      const yP2 = getClamped(i + 2);

      const sg = (-3 * yM2 + 12 * yM1 + 17 * y0 + 12 * yP1 - 3 * yP2) / 35.0;
      const deriv = (-2 * yM2 - yM1 + yP1 + 2 * yP2) / 10.0;

      sgSmoothed[i] = Number(sg.toFixed(6));
      velocity[i] = Number(deriv.toFixed(6));
    }

    // Forward Kalman pass + Backward Rauch-Tung-Striebel (RTS) smoother pass
    const Q = options?.processNoiseQ ?? 0.05;
    const R = options?.measurementNoiseR ?? 0.5;

    const xFwd = new Array<number>(n);
    const pFwd = new Array<number>(n);
    const xPred = new Array<number>(n);
    const pPred = new Array<number>(n);

    xFwd[0] = series[0]!;
    pFwd[0] = 1.0;

    for (let k = 1; k < n; k++) {
      xPred[k] = xFwd[k - 1]!;
      pPred[k] = pFwd[k - 1]! + Q;

      const gainK = pPred[k]! / (pPred[k]! + R);
      xFwd[k] = xPred[k]! + gainK * (series[k]! - xPred[k]!);
      pFwd[k] = (1.0 - gainK) * pPred[k]!;
    }

    const xRts = new Array<number>(n);
    xRts[n - 1] = Number(xFwd[n - 1]!.toFixed(6));

    for (let k = n - 2; k >= 0; k--) {
      const cGain = pFwd[k]! / Math.max(1e-12, pPred[k + 1]!);
      const smoothedVal = xFwd[k]! + cGain * (xRts[k + 1]! - xPred[k + 1]!);
      xRts[k] = Number(smoothedVal.toFixed(6));
    }

    return {
      savitzkyGolaySmoothed: sgSmoothed,
      firstDerivativeVelocity: velocity,
      rtsKalmanSmoothed: xRts
    };
  }
}
