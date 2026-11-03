import { randomBytes } from "node:crypto";

export interface PrivacyBudgetConfig {
  ownerId: string;
  maxEpsilon: number;
  maxDelta: number;
}

export interface PrivacyLedgerEntry {
  queryId: string;
  mechanism: "laplace" | "gaussian" | "randomized_response";
  metricName: string;
  epsilonSpent: number;
  deltaSpent: number;
  sensitivity: number;
  rawEstimate?: number;
  privatizedValue: number | boolean;
  timestampIso: string;
}

export interface PrivatizedNumericResult {
  queryId: string;
  metricName: string;
  privatizedValue: number;
  noiseAdded: number;
  scaleParameter: number;
  confidenceInterval95: [number, number];
  remainingEpsilon: number;
  remainingDelta: number;
}

/**
 * (epsilon, delta)-Differential Privacy Telemetry & Privacy Budget Accountant.
 * Provides sensitivity clamping, calibrated Laplace and Gaussian mechanisms,
 * Randomized Response for local boolean telemetry, and hard privacy budget enforcement.
 */
export class DifferentialPrivacyTelemetryEngine {
  private readonly ownerId: string;
  private readonly maxEpsilon: number;
  private readonly maxDelta: number;
  private spentEpsilon = 0;
  private spentDelta = 0;
  private readonly ledger: PrivacyLedgerEntry[] = [];
  private rngState: number | null;

  constructor(config: PrivacyBudgetConfig & { deterministicSeed?: number }) {
    if (config.maxEpsilon <= 0) {
      throw new Error("INVALID_PRIVACY_BUDGET: maxEpsilon must be > 0");
    }
    if (config.maxDelta < 0 || config.maxDelta >= 1) {
      throw new Error("INVALID_PRIVACY_BUDGET: maxDelta must be in [0, 1)");
    }
    this.ownerId = config.ownerId;
    this.maxEpsilon = config.maxEpsilon;
    this.maxDelta = config.maxDelta;
    this.rngState =
      config.deterministicSeed !== undefined ? config.deterministicSeed >>> 0 || 1 : null;
  }

  /**
   * Returns a uniform random number in (0, 1) using either CSPRNG or xorshift32 (when seeded for tests).
   */
  private nextUniformOpen(): number {
    if (this.rngState !== null) {
      let x = this.rngState;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.rngState = x >>> 0;
      // Map to (0, 1) strictly avoiding 0 and 1
      return ((this.rngState >>> 0) + 0.5) / 4294967296;
    }
    const buf = randomBytes(4);
    const uint = buf.readUInt32LE(0);
    return (uint + 0.5) / 4294967296;
  }

  /**
   * Clips an individual contribution to [lowerBound, upperBound] to bound L1/L2 sensitivity.
   */
  public static clipContribution(value: number, lowerBound: number, upperBound: number): number {
    if (lowerBound > upperBound) {
      throw new Error("INVALID_CLIP_BOUNDS: lowerBound cannot exceed upperBound");
    }
    return Math.min(upperBound, Math.max(lowerBound, value));
  }

  private chargeBudget(epsilon: number, delta: number): void {
    if (epsilon <= 0) {
      throw new Error("INVALID_EPSILON: epsilon must be > 0");
    }
    if (delta < 0) {
      throw new Error("INVALID_DELTA: delta must be >= 0");
    }
    const nextEps = Number((this.spentEpsilon + epsilon).toFixed(12));
    const nextDelta = Number((this.spentDelta + delta).toFixed(12));
    if (nextEps > this.maxEpsilon + 1e-12 || nextDelta > this.maxDelta + 1e-12) {
      throw new Error(
        `PRIVACY_BUDGET_EXHAUSTED: requested (eps=${epsilon}, delta=${delta}) exceeds remaining (${this.remainingEpsilon.toFixed(4)}, ${this.remainingDelta.toFixed(6)})`
      );
    }
    this.spentEpsilon = nextEps;
    this.spentDelta = nextDelta;
  }

  /**
   * Executes the Laplace Mechanism: adds Lap(sensitivity / epsilon) noise.
   * Satisfies pure (epsilon, 0)-Differential Privacy.
   */
  public releaseLaplaceMetric(params: {
    metricName: string;
    trueValue: number;
    l1Sensitivity: number;
    epsilon: number;
  }): PrivatizedNumericResult {
    if (params.l1Sensitivity <= 0) {
      throw new Error("INVALID_SENSITIVITY: l1Sensitivity must be > 0");
    }
    this.chargeBudget(params.epsilon, 0);

    const b = params.l1Sensitivity / params.epsilon;
    const u = this.nextUniformOpen() - 0.5;
    const sign = u < 0 ? -1 : 1;
    const noise = -b * sign * Math.log(1 - 2 * Math.abs(u));
    const privatizedValue = params.trueValue + noise;

    // 95% confidence interval for Laplace(0, b) is +/- b * ln(1 / 0.05) = b * ln(20)
    const margin95 = b * Math.log(20);
    const queryId = `dp_lap_${this.ledger.length + 1}`;

    this.ledger.push({
      queryId,
      mechanism: "laplace",
      metricName: params.metricName,
      epsilonSpent: params.epsilon,
      deltaSpent: 0,
      sensitivity: params.l1Sensitivity,
      privatizedValue,
      timestampIso: new Date().toISOString()
    });

    return {
      queryId,
      metricName: params.metricName,
      privatizedValue,
      noiseAdded: noise,
      scaleParameter: b,
      confidenceInterval95: [privatizedValue - margin95, privatizedValue + margin95],
      remainingEpsilon: this.remainingEpsilon,
      remainingDelta: this.remainingDelta
    };
  }

  /**
   * Executes the Analytic Gaussian Mechanism: adds N(0, sigma^2) noise where
   * sigma = l2Sensitivity * sqrt(2 * ln(1.25 / delta)) / epsilon.
   * Satisfies (epsilon, delta)-Differential Privacy.
   */
  public releaseGaussianMetric(params: {
    metricName: string;
    trueValue: number;
    l2Sensitivity: number;
    epsilon: number;
    delta: number;
  }): PrivatizedNumericResult {
    if (params.l2Sensitivity <= 0) {
      throw new Error("INVALID_SENSITIVITY: l2Sensitivity must be > 0");
    }
    if (params.delta <= 0 || params.delta >= 1) {
      throw new Error("INVALID_DELTA: Gaussian mechanism requires delta in (0, 1)");
    }
    this.chargeBudget(params.epsilon, params.delta);

    const sigma =
      (params.l2Sensitivity * Math.sqrt(2 * Math.log(1.25 / params.delta))) / params.epsilon;

    // Box-Muller transform
    const u1 = this.nextUniformOpen();
    const u2 = this.nextUniformOpen();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const noise = z0 * sigma;
    const privatizedValue = params.trueValue + noise;
    const margin95 = 1.95996 * sigma;
    const queryId = `dp_gauss_${this.ledger.length + 1}`;

    this.ledger.push({
      queryId,
      mechanism: "gaussian",
      metricName: params.metricName,
      epsilonSpent: params.epsilon,
      deltaSpent: params.delta,
      sensitivity: params.l2Sensitivity,
      privatizedValue,
      timestampIso: new Date().toISOString()
    });

    return {
      queryId,
      metricName: params.metricName,
      privatizedValue,
      noiseAdded: noise,
      scaleParameter: sigma,
      confidenceInterval95: [privatizedValue - margin95, privatizedValue + margin95],
      remainingEpsilon: this.remainingEpsilon,
      remainingDelta: this.remainingDelta
    };
  }

  /**
   * Warner's Randomized Response for Local Differential Privacy (LDP) on boolean flags.
   * Reports truth with probability p = e^eps / (e^eps + 1).
   */
  public releaseRandomizedResponseBoolean(params: {
    metricName: string;
    truth: boolean;
    epsilon: number;
  }): {
    queryId: string;
    privatizedFlag: boolean;
    truthProbability: number;
    remainingEpsilon: number;
  } {
    this.chargeBudget(params.epsilon, 0);
    const expEps = Math.exp(params.epsilon);
    const truthProbability = expEps / (expEps + 1);
    const u = this.nextUniformOpen();
    const keepTruth = u <= truthProbability;
    const privatizedFlag = keepTruth ? params.truth : !params.truth;
    const queryId = `dp_rr_${this.ledger.length + 1}`;

    this.ledger.push({
      queryId,
      mechanism: "randomized_response",
      metricName: params.metricName,
      epsilonSpent: params.epsilon,
      deltaSpent: 0,
      sensitivity: 1,
      privatizedValue: privatizedFlag,
      timestampIso: new Date().toISOString()
    });

    return {
      queryId,
      privatizedFlag,
      truthProbability,
      remainingEpsilon: this.remainingEpsilon
    };
  }

  /**
   * Unbiased estimator for true proportion of 'true' flags from N Randomized Response reports.
   */
  public static estimateTrueProportionFromRandomizedResponses(
    responses: boolean[],
    epsilon: number
  ): number {
    if (responses.length === 0) return 0;
    const expEps = Math.exp(epsilon);
    const p = expEps / (expEps + 1);
    if (Math.abs(2 * p - 1) < 1e-9) return 0.5;
    const observedRate = responses.filter(Boolean).length / responses.length;
    const unbiased = (observedRate - (1 - p)) / (2 * p - 1);
    return Math.min(1, Math.max(0, unbiased));
  }

  public get remainingEpsilon(): number {
    return Math.max(0, Number((this.maxEpsilon - this.spentEpsilon).toFixed(12)));
  }

  public get remainingDelta(): number {
    return Math.max(0, Number((this.maxDelta - this.spentDelta).toFixed(12)));
  }

  public getAuditLedger(): ReadonlyArray<PrivacyLedgerEntry> {
    return [...this.ledger];
  }

  public getBudgetSummary(): {
    ownerId: string;
    maxEpsilon: number;
    spentEpsilon: number;
    remainingEpsilon: number;
    maxDelta: number;
    spentDelta: number;
    remainingDelta: number;
    queryCount: number;
  } {
    return {
      ownerId: this.ownerId,
      maxEpsilon: this.maxEpsilon,
      spentEpsilon: this.spentEpsilon,
      remainingEpsilon: this.remainingEpsilon,
      maxDelta: this.maxDelta,
      spentDelta: this.spentDelta,
      remainingDelta: this.remainingDelta,
      queryCount: this.ledger.length
    };
  }
}
