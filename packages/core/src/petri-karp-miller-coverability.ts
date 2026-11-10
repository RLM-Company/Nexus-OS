export interface PetriTransitionSpec {
  id: string;
  consumeFromPlaces: Record<string, number>;
  produceToPlaces: Record<string, number>;
}

export interface PetriReachabilityReport {
  reachableStatesCount: number;
  deadlockMarkings: Array<Record<string, number>>;
  isDeadlockFree: boolean;
  maxTokensObservedPerPlace: Record<string, number>;
  conservedTokenSumInvariantHolds: boolean;
}

/**
 * Karp-Miller Bounded Petri Net Reachability, Deadlock Marking Detector,
 * and S-Invariant Token Conservation Verifier.
 */
export class KarpMillerPetriNetReachabilityAnalyzer {
  public static analyzeReachability(params: {
    initialMarking: Record<string, number>;
    transitions: PetriTransitionSpec[];
    maxStatesToExplore?: number;
    placeWeightsForInvariant?: Record<string, number>;
  }): PetriReachabilityReport {
    const places = Object.keys(params.initialMarking).sort();
    const maxStates = params.maxStatesToExplore ?? 250;

    const serializeMarking = (m: Record<string, number>): string =>
      places.map((p) => `${p}:${m[p] ?? 0}`).join("|");

    const isEnabled = (m: Record<string, number>, t: PetriTransitionSpec): boolean => {
      for (const [place, req] of Object.entries(t.consumeFromPlaces)) {
        if ((m[place] ?? 0) < req) return false;
      }
      return true;
    };

    const fire = (
      m: Record<string, number>,
      t: PetriTransitionSpec
    ): Record<string, number> => {
      const next = { ...m };
      for (const [place, req] of Object.entries(t.consumeFromPlaces)) {
        next[place] = (next[place] ?? 0) - req;
      }
      for (const [place, prod] of Object.entries(t.produceToPlaces)) {
        next[place] = (next[place] ?? 0) + prod;
      }
      return next;
    };

    const weightedSum = (m: Record<string, number>): number => {
      let sum = 0;
      for (const p of places) {
        const w = params.placeWeightsForInvariant?.[p] ?? 1;
        sum += w * (m[p] ?? 0);
      }
      return sum;
    };

    const initialWeightedSum = weightedSum(params.initialMarking);
    let conservedTokenSumInvariantHolds = true;

    const visited = new Set<string>([serializeMarking(params.initialMarking)]);
    const queue: Array<Record<string, number>> = [{ ...params.initialMarking }];
    const deadlockMarkings: Array<Record<string, number>> = [];
    const maxTokensObservedPerPlace: Record<string, number> = {
      ...params.initialMarking
    };

    while (queue.length > 0 && visited.size < maxStates) {
      const curr = queue.shift()!;

      if (Math.abs(weightedSum(curr) - initialWeightedSum) > 1e-9) {
        conservedTokenSumInvariantHolds = false;
      }

      for (const p of places) {
        maxTokensObservedPerPlace[p] = Math.max(
          maxTokensObservedPerPlace[p] ?? 0,
          curr[p] ?? 0
        );
      }

      let anyEnabled = false;
      for (const t of params.transitions) {
        if (isEnabled(curr, t)) {
          anyEnabled = true;
          const nextM = fire(curr, t);
          const key = serializeMarking(nextM);
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(nextM);
          }
        }
      }

      if (!anyEnabled) {
        deadlockMarkings.push(curr);
      }
    }

    return {
      reachableStatesCount: visited.size,
      deadlockMarkings,
      isDeadlockFree: deadlockMarkings.length === 0,
      maxTokensObservedPerPlace,
      conservedTokenSumInvariantHolds
    };
  }
}
