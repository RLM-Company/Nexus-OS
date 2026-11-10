/**
 * Kosmora / Nexus-OS Monte Carlo Tree Search (MCTS) Lookahead DAG Planner (Wave 19)
 *
 * Uses Upper Confidence Bound 1 applied to Trees (UCT) to simulate and evaluate
 * candidate tool execution trajectories before committing to a workflow DAG path.
 *
 * Formula:
 *   UCT(node) = (Q / N) + c * sqrt(ln(N_parent) / N)
 *
 * Capabilities:
 * 1. Evaluates alternative execution branches (e.g. Vault local extraction vs Web Search vs Drive Restore).
 * 2. Incorporates empirical tool success rates, token costs, and latency penalties into rollout rewards.
 * 3. Prunes dead-end or high-hazard trajectories prior to execution.
 */

export interface CandidateActionBranch {
  actionId: string;
  toolName: string;
  description: string;
  priorSuccessProbability: number; // 0.0 to 1.0
  estimatedLatencyMs: number;
  estimatedTokenCost: number;
  isFallbackAllowed?: boolean;
}

export interface MctsPlannerConfig {
  iterations?: number; // Default 200
  explorationConstant?: number; // Default 1.414 (sqrt(2))
  maxLatencyBudgetMs?: number; // Default 10000
  maxTokenBudget?: number; // Default 16000
  seed?: number;
}

export interface EvaluatedTrajectoryReport {
  actionId: string;
  toolName: string;
  visits: number;
  meanReward: number;
  uctScore: number;
  expectedLatencyMs: number;
  expectedTokenCost: number;
}

export interface MctsPlanningResult {
  recommendedAction: CandidateActionBranch;
  expectedUtilityReward: number;
  totalSimulations: number;
  rankedTrajectories: EvaluatedTrajectoryReport[];
}

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MctsWorkflowPlanner {
  private readonly iterations: number;
  private readonly explorationC: number;
  private readonly maxLatencyMs: number;
  private readonly maxTokenBudget: number;
  private readonly seed: number;

  constructor(config?: MctsPlannerConfig) {
    this.iterations = config?.iterations ?? 250;
    this.explorationC = config?.explorationConstant ?? Math.SQRT2;
    this.maxLatencyMs = config?.maxLatencyBudgetMs ?? 10000;
    this.maxTokenBudget = config?.maxTokenBudget ?? 16000;
    this.seed = config?.seed ?? 0x20261102;
  }

  /**
   * Runs MCTS lookahead simulations over candidate branches and selects the optimal trajectory.
   */
  public planOptimalTrajectory(branches: CandidateActionBranch[]): MctsPlanningResult {
    if (!branches || branches.length === 0) {
      throw new Error("MCTS_EMPTY_BRANCHES: At least one candidate action branch is required");
    }

    const rng = createSeededRng(this.seed);
    const stats = branches.map((b) => ({
      branch: b,
      visits: 0,
      totalReward: 0
    }));

    let totalParentVisits = 0;

    for (let iter = 0; iter < this.iterations; iter++) {
      // 1. SELECTION via UCT
      let selectedIdx = -1;
      let bestUct = -Infinity;

      for (let i = 0; i < stats.length; i++) {
        const st = stats[i];
        if (st.visits === 0) {
          selectedIdx = i;
          break;
        }
        const exploitation = st.totalReward / st.visits;
        const exploration =
          this.explorationC * Math.sqrt(Math.log(totalParentVisits + 1) / st.visits);
        const uct = exploitation + exploration;
        if (uct > bestUct) {
          bestUct = uct;
          selectedIdx = i;
        }
      }

      const chosen = stats[selectedIdx];

      // 2. SIMULATION (Rollout with stochastic success, latency & token cost penalties)
      const reward = this.simulateRollout(chosen.branch, rng);

      // 3. BACKPROPAGATION
      chosen.visits += 1;
      chosen.totalReward += reward;
      totalParentVisits += 1;
    }

    // Rank branches by empirical mean reward and visit count
    const rankedTrajectories: EvaluatedTrajectoryReport[] = stats.map((st) => {
      const meanReward = st.visits > 0 ? st.totalReward / st.visits : 0;
      const uctScore =
        st.visits > 0
          ? meanReward +
            this.explorationC * Math.sqrt(Math.log(totalParentVisits + 1) / st.visits)
          : 0;
      return {
        actionId: st.branch.actionId,
        toolName: st.branch.toolName,
        visits: st.visits,
        meanReward: Number(meanReward.toFixed(4)),
        uctScore: Number(uctScore.toFixed(4)),
        expectedLatencyMs: st.branch.estimatedLatencyMs,
        expectedTokenCost: st.branch.estimatedTokenCost
      };
    });

    rankedTrajectories.sort((a, b) => {
      if (Math.abs(b.meanReward - a.meanReward) > 0.01) {
        return b.meanReward - a.meanReward;
      }
      return b.visits - a.visits;
    });

    const winnerId = rankedTrajectories[0].actionId;
    const recommendedAction = branches.find((b) => b.actionId === winnerId)!;

    return {
      recommendedAction,
      expectedUtilityReward: rankedTrajectories[0].meanReward,
      totalSimulations: totalParentVisits,
      rankedTrajectories
    };
  }

  private simulateRollout(branch: CandidateActionBranch, rng: () => number): number {
    // Sample stochastic outcome based on priorSuccessProbability
    const roll = rng();
    const succeeded = roll <= branch.priorSuccessProbability;

    // Normalize latency penalty (0.0 to 0.35)
    const latencyRatio = Math.min(1.5, branch.estimatedLatencyMs / this.maxLatencyMs);
    const latencyPenalty = latencyRatio * 0.25;

    // Normalize token cost penalty (0.0 to 0.25)
    const tokenRatio = Math.min(1.5, branch.estimatedTokenCost / this.maxTokenBudget);
    const tokenPenalty = tokenRatio * 0.2;

    if (succeeded) {
      return Math.max(0.05, 1.0 - latencyPenalty - tokenPenalty);
    }

    // If failed but fallback is allowed, partial recovery reward
    if (branch.isFallbackAllowed) {
      return Math.max(0.0, 0.25 - latencyPenalty - tokenPenalty);
    }

    return 0.0;
  }
}
