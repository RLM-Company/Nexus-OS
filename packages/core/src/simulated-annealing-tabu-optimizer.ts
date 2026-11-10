export interface AnnealingOptimizationResult<TState> {
  bestState: TState;
  bestEnergyCost: number;
  initialEnergyCost: number;
  improvementRatio: number;
  iterationsExecuted: number;
  tabuSkipsCount: number;
}

/**
 * Simulated Annealing + Tabu Tenure Combinatorial Optimizer.
 * Minimizes arbitrary energy/cost functions over discrete combinatorial spaces using
 * Metropolis Boltzmann acceptance exp(-deltaE / T), geometric cooling, and a short-term
 * Tabu list with global-best Aspiration Criterion.
 */
export class SimulatedAnnealingTabuOptimizer {
  public static optimize<TState>(params: {
    initialState: TState;
    energyCostFn: (state: TState) => number;
    generateNeighborsFn: (state: TState) => TState[];
    hashStateFn: (state: TState) => string;
    initialTemperature?: number;
    coolingRateAlpha?: number;
    maxIterations?: number;
    tabuTenure?: number;
    deterministicSeed?: number;
  }): AnnealingOptimizationResult<TState> {
    let current = params.initialState;
    let currentCost = params.energyCostFn(current);
    const initialCost = currentCost;

    let bestState = current;
    let bestCost = currentCost;

    let temp = params.initialTemperature ?? 100.0;
    const alpha = params.coolingRateAlpha ?? 0.92;
    const maxIter = params.maxIterations ?? 120;
    const tabuTenure = params.tabuTenure ?? 8;

    const tabuQueue: string[] = [];
    const tabuSet = new Set<string>();
    let tabuSkipsCount = 0;

    let rngState = (params.deterministicSeed ?? 1337) >>> 0;
    const nextUniform = () => {
      rngState ^= rngState << 13;
      rngState ^= rngState >>> 17;
      rngState ^= rngState << 5;
      return ((rngState >>> 0) + 0.5) / 4294967296;
    };

    const recordTabu = (hash: string) => {
      if (tabuSet.has(hash)) return;
      tabuSet.add(hash);
      tabuQueue.push(hash);
      if (tabuQueue.length > tabuTenure) {
        const oldest = tabuQueue.shift()!;
        tabuSet.delete(oldest);
      }
    };

    recordTabu(params.hashStateFn(current));

    let iter = 0;
    for (; iter < maxIter && temp > 1e-4; iter++) {
      const neighbors = params.generateNeighborsFn(current);
      if (neighbors.length === 0) break;

      // Evaluate neighbors; allow Tabu move ONLY if it satisfies Aspiration Criterion (cost < bestCost)
      let chosenNeighbor: TState | null = null;
      let chosenCost = Infinity;
      let chosenHash = "";

      for (const nb of neighbors) {
        const h = params.hashStateFn(nb);
        const c = params.energyCostFn(nb);
        if (tabuSet.has(h) && c >= bestCost) {
          tabuSkipsCount++;
          continue;
        }
        if (c < chosenCost) {
          chosenCost = c;
          chosenNeighbor = nb;
          chosenHash = h;
        }
      }

      if (!chosenNeighbor) break;

      const deltaE = chosenCost - currentCost;
      const acceptProbability = deltaE <= 0 ? 1.0 : Math.exp(-deltaE / temp);

      if (deltaE <= 0 || nextUniform() < acceptProbability) {
        current = chosenNeighbor;
        currentCost = chosenCost;
        recordTabu(chosenHash);

        if (currentCost < bestCost) {
          bestState = current;
          bestCost = currentCost;
        }
      }

      temp *= alpha;
    }

    const improvementRatio =
      initialCost > 1e-9
        ? Number(((initialCost - bestCost) / initialCost).toFixed(4))
        : 0;

    return {
      bestState,
      bestEnergyCost: Number(bestCost.toFixed(6)),
      initialEnergyCost: Number(initialCost.toFixed(6)),
      improvementRatio,
      iterationsExecuted: iter,
      tabuSkipsCount
    };
  }
}
