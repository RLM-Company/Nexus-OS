export interface Ukf1DState {
  meanX: number;
  varianceP: number;
}

export interface UkfUpdateStepResult {
  sigmaPoints: [number, number, number];
  predictedMean: number;
  predictedVariance: number;
  kalmanGainK: number;
  posteriorMean: number;
  posteriorVariance: number;
}

/**
 * Julier & Uhlmann Unscented Kalman Filter (UKF) with Deterministic Sigma-Point Transform.
 * Propagates 2n+1 sigma points (x0 = mu, x1 = mu + sqrt((n+kappa)P), x2 = mu - sqrt((n+kappa)P))
 * directly through arbitrary nonlinear state transition f(x) and observation h(x) functions
 * without requiring Jacobian linearization.
 */
export class UnscentedKalmanSigmaPointFilter {
  public static stepNonlinear1D(params: {
    prior: Ukf1DState;
    processNoiseQ: number;
    measurementNoiseR: number;
    observedZ: number;
    transitionFn: (x: number) => number;
    observationFn: (x: number) => number;
    kappa?: number;
  }): UkfUpdateStepResult {
    const kappa = params.kappa ?? 2; // For 1D Gaussian, n + kappa = 3 matches 4th-order kurtosis
    const n = 1;
    const scale = Math.sqrt((n + kappa) * Math.max(1e-12, params.prior.varianceP));

    const sigmaX: [number, number, number] = [
      params.prior.meanX,
      params.prior.meanX + scale,
      params.prior.meanX - scale
    ];
    const weights: [number, number, number] = [
      kappa / (n + kappa),
      1 / (2 * (n + kappa)),
      1 / (2 * (n + kappa))
    ];

    // 1. Propagate sigma points through nonlinear transitionFn
    const propY = sigmaX.map((s) => params.transitionFn(s)) as [number, number, number];
    let predMean = 0;
    for (let i = 0; i < 3; i++) predMean += weights[i]! * propY[i]!;

    let predVar = params.processNoiseQ;
    for (let i = 0; i < 3; i++) {
      const diff = propY[i]! - predMean;
      predVar += weights[i]! * diff * diff;
    }

    // 2. Redraw sigma points around predicted state and pass through observationFn
    const predScale = Math.sqrt((n + kappa) * Math.max(1e-12, predVar));
    const predSigma: [number, number, number] = [
      predMean,
      predMean + predScale,
      predMean - predScale
    ];
    const obsZ = predSigma.map((s) => params.observationFn(s)) as [number, number, number];

    let zMean = 0;
    for (let i = 0; i < 3; i++) zMean += weights[i]! * obsZ[i]!;

    let szz = params.measurementNoiseR;
    let sxz = 0;
    for (let i = 0; i < 3; i++) {
      const dz = obsZ[i]! - zMean;
      const dx = predSigma[i]! - predMean;
      szz += weights[i]! * dz * dz;
      sxz += weights[i]! * dx * dz;
    }

    const kalmanGainK = sxz / Math.max(1e-12, szz);
    const posteriorMean = predMean + kalmanGainK * (params.observedZ - zMean);
    const posteriorVariance = Math.max(1e-12, predVar - kalmanGainK * kalmanGainK * szz);

    return {
      sigmaPoints: sigmaX,
      predictedMean: Number(predMean.toFixed(6)),
      predictedVariance: Number(predVar.toFixed(6)),
      kalmanGainK: Number(kalmanGainK.toFixed(6)),
      posteriorMean: Number(posteriorMean.toFixed(6)),
      posteriorVariance: Number(posteriorVariance.toFixed(6))
    };
  }
}
