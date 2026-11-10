export interface MultiObjectiveCandidate {
  id: string;
  label: string;
  qualityScore: number; // Maximize [0..1]
  latencyMs: number; // Minimize (> 0)
  costUsd: number; // Minimize (>= 0)
  privacyScore: number; // Maximize [0..1]
}

export interface ParetoEvaluatedCandidate extends MultiObjectiveCandidate {
  paretoFrontRank: number; // 1 = Pareto-optimal front F_1
  crowdingDistance: number;
  scalarizedUtility: number;
}

/**
 * NSGA-II Multi-Objective Pareto Frontier Optimizer.
 * Computes non-dominated Pareto fronts (F_1, F_2, ...) and crowding distances
 * across 4 competing objectives: Quality (max), Latency (min), Cost (min), and Privacy (max).
 */
export class ParetoFrontierOptimizer {
  /**
   * Returns true if candidate A Pareto-dominates candidate B:
   * A is at least as good as B on all 4 objectives and strictly better on at least one.
   */
  public static dominates(a: MultiObjectiveCandidate, b: MultiObjectiveCandidate): boolean {
    const noWorse =
      a.qualityScore >= b.qualityScore &&
      a.latencyMs <= b.latencyMs &&
      a.costUsd <= b.costUsd &&
      a.privacyScore >= b.privacyScore;

    const strictlyBetter =
      a.qualityScore > b.qualityScore ||
      a.latencyMs < b.latencyMs ||
      a.costUsd < b.costUsd ||
      a.privacyScore > b.privacyScore;

    return noWorse && strictlyBetter;
  }

  public static evaluateParetoFrontier(
    candidates: MultiObjectiveCandidate[],
    preferenceWeights?: {
      quality?: number;
      latency?: number;
      cost?: number;
      privacy?: number;
    }
  ): {
    paretoOptimalFront: ParetoEvaluatedCandidate[];
    allRanked: ParetoEvaluatedCandidate[];
    recommendedWinner: ParetoEvaluatedCandidate | null;
  } {
    if (candidates.length === 0) {
      return { paretoOptimalFront: [], allRanked: [], recommendedWinner: null };
    }

    const wQuality = preferenceWeights?.quality ?? 0.4;
    const wLatency = preferenceWeights?.latency ?? 0.25;
    const wCost = preferenceWeights?.cost ?? 0.15;
    const wPrivacy = preferenceWeights?.privacy ?? 0.2;

    const maxLat = Math.max(1, ...candidates.map((c) => c.latencyMs));
    const maxCost = Math.max(0.0001, ...candidates.map((c) => c.costUsd));

    // Fast Non-Dominated Sorting
    const remaining = new Set(candidates.map((c) => c.id));
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const rankById = new Map<string, number>();

    let currentRank = 1;
    while (remaining.size > 0) {
      const currentFrontIds: string[] = [];
      for (const idA of remaining) {
        const candA = byId.get(idA)!;
        let isDominated = false;
        for (const idB of remaining) {
          if (idA === idB) continue;
          const candB = byId.get(idB)!;
          if (ParetoFrontierOptimizer.dominates(candB, candA)) {
            isDominated = true;
            break;
          }
        }
        if (!isDominated) {
          currentFrontIds.push(idA);
        }
      }

      for (const id of currentFrontIds) {
        rankById.set(id, currentRank);
        remaining.delete(id);
      }
      currentRank++;
    }

    const evaluated: ParetoEvaluatedCandidate[] = candidates.map((c) => {
      const normLat = 1 - Math.min(1, c.latencyMs / maxLat);
      const normCost = 1 - Math.min(1, c.costUsd / maxCost);
      const scalarizedUtility = Number(
        (
          wQuality * c.qualityScore +
          wLatency * normLat +
          wCost * normCost +
          wPrivacy * c.privacyScore
        ).toFixed(4)
      );

      return {
        ...c,
        paretoFrontRank: rankById.get(c.id) ?? 1,
        crowdingDistance: 0,
        scalarizedUtility
      };
    });

    // Compute crowding distance on Front 1
    const front1 = evaluated.filter((e) => e.paretoFrontRank === 1);
    if (front1.length <= 2) {
      for (const f of front1) f.crowdingDistance = 100;
    } else {
      front1.sort((a, b) => a.qualityScore - b.qualityScore);
      front1[0]!.crowdingDistance = 100;
      front1[front1.length - 1]!.crowdingDistance = 100;
      for (let i = 1; i < front1.length - 1; i++) {
        front1[i]!.crowdingDistance = Number(
          (front1[i + 1]!.qualityScore - front1[i - 1]!.qualityScore).toFixed(4)
        );
      }
    }

    evaluated.sort((a, b) => {
      if (a.paretoFrontRank !== b.paretoFrontRank) {
        return a.paretoFrontRank - b.paretoFrontRank;
      }
      return b.scalarizedUtility - a.scalarizedUtility;
    });

    return {
      paretoOptimalFront: evaluated.filter((e) => e.paretoFrontRank === 1),
      allRanked: evaluated,
      recommendedWinner: evaluated[0] ?? null
    };
  }
}
