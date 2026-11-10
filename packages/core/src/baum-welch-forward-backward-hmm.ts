export interface ForwardBackwardPosteriorResult {
  sequenceLikelihood: number;
  posteriorGammaByStep: Array<Record<string, number>>; // P(S_t = i | O_{1:T})
  expectedStateOccupancyCounts: Record<string, number>;
}

/**
 * Rabiner Forward-Backward (Alpha-Beta) Posterior State Probability &
 * Baum-Welch Expectation-Maximization (EM) Sufficient Statistics Engine.
 */
export class ForwardBackwardPosteriorHmmEngine {
  public static computeForwardBackwardPosteriors(params: {
    states: string[];
    initialProbabilities: Record<string, number>;
    transitionMatrix: Record<string, Record<string, number>>;
    emissionMatrix: Record<string, Record<string, number>>;
    observations: string[];
  }): ForwardBackwardPosteriorResult {
    const T = params.observations.length;
    const S = params.states.length;
    if (T === 0 || S === 0) {
      return {
        sequenceLikelihood: 0,
        posteriorGammaByStep: [],
        expectedStateOccupancyCounts: {}
      };
    }

    const alpha: number[][] = Array.from({ length: T }, () => new Array<number>(S).fill(0));
    const beta: number[][] = Array.from({ length: T }, () => new Array<number>(S).fill(0));

    // 1. Forward Pass (Alpha)
    const obs0 = params.observations[0]!;
    for (let i = 0; i < S; i++) {
      const st = params.states[i]!;
      alpha[0]![i] =
        (params.initialProbabilities[st] ?? 1.0 / S) *
        (params.emissionMatrix[st]?.[obs0] ?? 1e-6);
    }

    for (let t = 1; t < T; t++) {
      const obsT = params.observations[t]!;
      for (let j = 0; j < S; j++) {
        const stJ = params.states[j]!;
        let sum = 0;
        for (let i = 0; i < S; i++) {
          const stI = params.states[i]!;
          sum += alpha[t - 1]![i]! * (params.transitionMatrix[stI]?.[stJ] ?? 1e-6);
        }
        alpha[t]![j] = sum * (params.emissionMatrix[stJ]?.[obsT] ?? 1e-6);
      }
    }

    const sequenceLikelihood = alpha[T - 1]!.reduce((a, b) => a + b, 0);

    // 2. Backward Pass (Beta)
    for (let i = 0; i < S; i++) {
      beta[T - 1]![i] = 1.0;
    }

    for (let t = T - 2; t >= 0; t--) {
      const obsNext = params.observations[t + 1]!;
      for (let i = 0; i < S; i++) {
        const stI = params.states[i]!;
        let sum = 0;
        for (let j = 0; j < S; j++) {
          const stJ = params.states[j]!;
          sum +=
            (params.transitionMatrix[stI]?.[stJ] ?? 1e-6) *
            (params.emissionMatrix[stJ]?.[obsNext] ?? 1e-6) *
            beta[t + 1]![j]!;
        }
        beta[t]![i] = sum;
      }
    }

    // 3. Posterior State Marginals Gamma_t(i) = (alpha_t(i) * beta_t(i)) / sum_k(alpha_t(k) * beta_t(k))
    const posteriorGammaByStep: Array<Record<string, number>> = [];
    const expectedStateOccupancyCounts: Record<string, number> = {};
    for (const st of params.states) expectedStateOccupancyCounts[st] = 0;

    for (let t = 0; t < T; t++) {
      let denom = 0;
      for (let i = 0; i < S; i++) {
        denom += alpha[t]![i]! * beta[t]![i]!;
      }
      const stepGamma: Record<string, number> = {};
      for (let i = 0; i < S; i++) {
        const st = params.states[i]!;
        const g =
          denom <= 1e-18 ? 1.0 / S : (alpha[t]![i]! * beta[t]![i]!) / denom;
        stepGamma[st] = Number(g.toFixed(6));
        expectedStateOccupancyCounts[st] = Number(
          ((expectedStateOccupancyCounts[st] ?? 0) + g).toFixed(6)
        );
      }
      posteriorGammaByStep.push(stepGamma);
    }

    return {
      sequenceLikelihood: Number(sequenceLikelihood.toFixed(9)),
      posteriorGammaByStep,
      expectedStateOccupancyCounts
    };
  }
}
