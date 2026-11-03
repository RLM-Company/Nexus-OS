/**
 * Kosmora / Nexus-OS Bayesian Thompson Sampling Multi-Armed Bandit Strategy Router (Wave 21)
 *
 * Dynamically routes tasks across competing execution strategies or tool providers
 * by maintaining Beta(alpha, beta) posterior distributions over reward outcomes
 * and sampling from each arm's posterior via Marsaglia-Tsang Gamma variates.
 *
 * Advantages over static priority lists:
 * 1. Automatically adapts when a primary tool or endpoint degrades in reliability or latency.
 * 2. Balances exploration of under-tested strategies with exploitation of proven high-reward arms.
 * 3. Supports non-stationary decay (`decayFactor`) so recent successes/failures weigh more heavily.
 */

export interface BanditStrategyArm {
  armId: string;
  label: string;
  alpha: number; // Prior + empirical successes
  beta: number; // Prior + empirical failures
  totalPulls: number;
  meanLatencyMs: number;
}

export interface BanditSelectionResult {
  selectedArmId: string;
  sampledTheta: number;
  posteriorMean: number;
  allSamples: Array<{ armId: string; sampledTheta: number; posteriorMean: number }>;
}

function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.max(1e-9, ((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

function sampleStandardNormal(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Samples from Gamma(shape, 1) using the Marsaglia-Tsang (2000) method.
 */
export function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1.0) {
    const u = rng();
    return sampleGamma(shape + 1.0, rng) * Math.pow(u, 1.0 / shape);
  }
  const d = shape - 1.0 / 3.0;
  const c = 1.0 / Math.sqrt(9.0 * d);
  while (true) {
    let x = sampleStandardNormal(rng);
    let v = 1.0 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = rng();
    if (u < 1.0 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1.0 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Samples from Beta(alpha, beta) via two independent Gamma variates:
 *   X ~ Gamma(alpha, 1), Y ~ Gamma(beta, 1)  =>  X / (X + Y) ~ Beta(alpha, beta)
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(Math.max(0.1, alpha), rng);
  const y = sampleGamma(Math.max(0.1, beta), rng);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

export class ThompsonSamplingBanditRouter {
  private readonly arms = new Map<string, BanditStrategyArm>();
  private readonly rng: () => number;
  private readonly decayFactor: number;

  constructor(options?: { seed?: number; decayFactor?: number }) {
    this.rng = createMulberry32(options?.seed ?? 0x20261102);
    this.decayFactor = options?.decayFactor ?? 0.99;
  }

  public registerArm(armId: string, label: string, priorAlpha = 1.0, priorBeta = 1.0): void {
    this.arms.set(armId, {
      armId,
      label,
      alpha: Math.max(0.5, priorAlpha),
      beta: Math.max(0.5, priorBeta),
      totalPulls: 0,
      meanLatencyMs: 0
    });
  }

  /**
   * Selects the best strategy arm by drawing a Thompson sample from each arm's Beta(alpha, beta)
   * posterior and applying a gentle latency tie-breaker.
   */
  public selectStrategyArm(): BanditSelectionResult {
    if (this.arms.size === 0) {
      throw new Error("BANDIT_NO_ARMS: Register at least one strategy arm before selection");
    }

    const allSamples: Array<{ armId: string; sampledTheta: number; posteriorMean: number }> = [];
    let bestArmId = "";
    let bestScore = -Infinity;
    let bestTheta = 0;
    let bestMean = 0;

    for (const arm of this.arms.values()) {
      const theta = sampleBeta(arm.alpha, arm.beta, this.rng);
      const mean = arm.alpha / (arm.alpha + arm.beta);
      // Slight penalty for high latency (up to 0.05)
      const latencyPenalty = Math.min(0.05, (arm.meanLatencyMs / 10000) * 0.05);
      const effectiveScore = theta - latencyPenalty;

      allSamples.push({
        armId: arm.armId,
        sampledTheta: Number(theta.toFixed(4)),
        posteriorMean: Number(mean.toFixed(4))
      });

      if (effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestArmId = arm.armId;
        bestTheta = theta;
        bestMean = mean;
      }
    }

    return {
      selectedArmId: bestArmId,
      sampledTheta: Number(bestTheta.toFixed(4)),
      posteriorMean: Number(bestMean.toFixed(4)),
      allSamples
    };
  }

  /**
   * Updates the Beta(alpha, beta) posterior of an arm after observing an execution outcome.
   */
  public recordArmOutcome(
    armId: string,
    options: { succeeded: boolean; latencyMs?: number; rewardWeight?: number }
  ): BanditStrategyArm {
    const arm = this.arms.get(armId);
    if (!arm) {
      throw new Error(`BANDIT_ARM_NOT_FOUND: Unknown arm '${armId}'`);
    }

    const weight = Math.max(0.1, Math.min(5.0, options.rewardWeight ?? 1.0));
    // Apply non-stationary exponential forgetting to old observations
    arm.alpha = Math.max(0.5, arm.alpha * this.decayFactor);
    arm.beta = Math.max(0.5, arm.beta * this.decayFactor);

    if (options.succeeded) {
      arm.alpha += weight;
    } else {
      arm.beta += weight;
    }

    arm.totalPulls += 1;
    if (options.latencyMs !== undefined && options.latencyMs >= 0) {
      arm.meanLatencyMs =
        arm.totalPulls === 1
          ? options.latencyMs
          : 0.2 * options.latencyMs + 0.8 * arm.meanLatencyMs;
    }

    return { ...arm };
  }

  public getArmsSnapshot(): BanditStrategyArm[] {
    return Array.from(this.arms.values()).map((a) => ({ ...a }));
  }
}
