export interface HmmModelParameters<TState extends string, TObs extends string> {
  states: TState[];
  initialProbabilities: Record<TState, number>;
  transitionMatrix: Record<TState, Record<TState, number>>;
  emissionMatrix: Record<TState, Record<TObs, number>>;
}

export interface ViterbiDecodedPath<TState extends string> {
  mostLikelyStates: TState[];
  logProbability: number;
}

/**
 * Log-Space Viterbi Hidden Markov Model (HMM) Latent Intent & Session Phase Decoder.
 * Decodes the globally optimal sequence of hidden user cognitive states from observable
 * turn tokens/actions without floating-point underflow.
 */
export class ViterbiIntentDecoder {
  public static decodeMostLikelySequence<TState extends string, TObs extends string>(
    model: HmmModelParameters<TState, TObs>,
    observations: TObs[]
  ): ViterbiDecodedPath<TState> {
    if (observations.length === 0 || model.states.length === 0) {
      return { mostLikelyStates: [], logProbability: 0 };
    }

    const states = model.states;
    const T = observations.length;
    const S = states.length;

    const safeLog = (p: number) => Math.log(Math.max(1e-12, p));

    // trellis[t][s]: max log probability of state s at time t
    const trellis: number[][] = Array.from({ length: T }, () => new Array<number>(S).fill(-Infinity));
    const backpointers: number[][] = Array.from({ length: T }, () => new Array<number>(S).fill(0));

    // Step 0 initialization
    const obs0 = observations[0]!;
    for (let s = 0; s < S; s++) {
      const stateName = states[s]!;
      const initP = model.initialProbabilities[stateName] ?? 1 / S;
      const emitP = model.emissionMatrix[stateName]?.[obs0] ?? 1e-6;
      trellis[0]![s] = safeLog(initP) + safeLog(emitP);
    }

    // Recursion across t = 1..T-1
    for (let t = 1; t < T; t++) {
      const obsT = observations[t]!;
      for (let currIdx = 0; currIdx < S; currIdx++) {
        const currState = states[currIdx]!;
        const emitLogP = safeLog(model.emissionMatrix[currState]?.[obsT] ?? 1e-6);

        let bestPrevIdx = 0;
        let bestLogProb = -Infinity;

        for (let prevIdx = 0; prevIdx < S; prevIdx++) {
          const prevState = states[prevIdx]!;
          const transLogP = safeLog(model.transitionMatrix[prevState]?.[currState] ?? 1e-6);
          const candidateLogProb = trellis[t - 1]![prevIdx]! + transLogP + emitLogP;
          if (candidateLogProb > bestLogProb) {
            bestLogProb = candidateLogProb;
            bestPrevIdx = prevIdx;
          }
        }

        trellis[t]![currIdx] = bestLogProb;
        backpointers[t]![currIdx] = bestPrevIdx;
      }
    }

    // Termination & Backtracking
    let bestFinalIdx = 0;
    let bestFinalLogProb = -Infinity;
    for (let s = 0; s < S; s++) {
      if (trellis[T - 1]![s]! > bestFinalLogProb) {
        bestFinalLogProb = trellis[T - 1]![s]!;
        bestFinalIdx = s;
      }
    }

    const decodedIndices = new Array<number>(T);
    decodedIndices[T - 1] = bestFinalIdx;
    for (let t = T - 1; t >= 1; t--) {
      decodedIndices[t - 1] = backpointers[t]![decodedIndices[t]!]!;
    }

    return {
      mostLikelyStates: decodedIndices.map((idx) => states[idx]!),
      logProbability: Number(bestFinalLogProb.toFixed(4))
    };
  }
}
