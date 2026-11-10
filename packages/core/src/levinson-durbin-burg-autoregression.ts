export interface ArModelForecastResult {
  orderP: number;
  arCoefficientsPhi: number[];
  reflectionCoefficientsPacf: number[];
  innovationVariance: number;
  forecasts: number[];
}

/**
 * Yule-Walker Autocorrelation & Levinson-Durbin O(p^2) Toeplitz Recursion
 * for Autoregressive AR(p) Time-Series Modeling & Multi-Step Forecasting.
 */
export class LevinsonDurbinArForecastEngine {
  public static fitAndForecast(
    series: number[],
    orderP = 2,
    horizonSteps = 3
  ): ArModelForecastResult {
    const n = series.length;
    const p = Math.max(1, Math.min(orderP, n - 1));
    const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const centered = series.map((v) => v - mean);

    // Empirical autocovariance r[0..p]
    const r = new Array<number>(p + 1).fill(0);
    for (let lag = 0; lag <= p; lag++) {
      let sum = 0;
      for (let t = lag; t < n; t++) {
        sum += centered[t]! * centered[t - lag]!;
      }
      r[lag] = sum / n;
    }

    if (Math.abs(r[0]!) <= 1e-12) {
      return {
        orderP: p,
        arCoefficientsPhi: new Array<number>(p).fill(0),
        reflectionCoefficientsPacf: new Array<number>(p).fill(0),
        innovationVariance: 0,
        forecasts: new Array<number>(horizonSteps).fill(Number(mean.toFixed(6)))
      };
    }

    // Levinson-Durbin recursion
    let phi = new Array<number>(p + 1).fill(0);
    const pacf = new Array<number>(p).fill(0);
    let errVar = r[0]!;

    for (let k = 1; k <= p; k++) {
      let num = r[k]!;
      for (let j = 1; j < k; j++) {
        num -= phi[j]! * r[k - j]!;
      }
      const kk = num / Math.max(1e-12, errVar);
      pacf[k - 1] = Number(kk.toFixed(6));

      const nextPhi = [...phi];
      nextPhi[k] = kk;
      for (let j = 1; j < k; j++) {
        nextPhi[j] = phi[j]! - kk * phi[k - j]!;
      }
      phi = nextPhi;
      errVar *= 1.0 - kk * kk;
    }

    const arCoeffs = phi.slice(1, p + 1).map((c) => Number(c.toFixed(6)));

    // Multi-step ahead autoregression on centered history
    const history = [...centered];
    const forecasts: number[] = [];
    for (let step = 0; step < horizonSteps; step++) {
      let nextCentered = 0;
      for (let j = 1; j <= p; j++) {
        nextCentered += phi[j]! * history[history.length - j]!;
      }
      history.push(nextCentered);
      forecasts.push(Number((nextCentered + mean).toFixed(6)));
    }

    return {
      orderP: p,
      arCoefficientsPhi: arCoeffs,
      reflectionCoefficientsPacf: pacf,
      innovationVariance: Number(Math.max(0, errVar).toFixed(6)),
      forecasts
    };
  }
}
