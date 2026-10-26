/**
 * Stage 8 (F225-F256): Autonomous FinOps Economics, Multi-Provider UCB1 Bandit Router,
 * Differential Privacy (Epsilon-Delta) Noise Calibrator, Merkle Selective Disclosure Proofs
 * & GDPR/152-FZ Right-to-be-Forgotten Cryptographic Erasure Engine.
 */

import { createHash, randomBytes } from "node:crypto";

export interface ProviderBanditArm {
  provider_id: string;
  model_id: string;
  successes_alpha: number;
  failures_beta: number;
  pulls_count: number;
  ewma_latency_ms: number;
  cost_per_1k_usd: number;
  circuit_open: boolean;
}

export interface BanditRouteDecision {
  selected_provider_id: string;
  selected_model_id: string;
  ucb_utility_score: number;
  empirical_win_rate: number;
  estimated_cost_per_1k_usd: number;
  ranked_candidates: Array<{
    provider_id: string;
    model_id: string;
    ucb_score: number;
  }>;
}

export interface FinOpsSpendPoint {
  hour_index: number;
  spend_usd: number;
}

export interface FinOpsBurnForecast {
  tenant_id: string;
  current_cumulative_spend_usd: number;
  budget_cap_usd: number;
  hourly_burn_slope_usd: number;
  projected_exhaustion_hours: number | null;
  anomaly_z_score: number;
  anomaly_detected: boolean;
  throttle_recommended: boolean;
}

export interface DifferentialPrivacyResult {
  tenant_id: string;
  noised_value: number;
  epsilon_consumed: number;
  remaining_epsilon_budget: number;
  laplace_scale_b: number;
}

export interface ComplianceClaimLeaf {
  claim_id: string;
  category: "gdpr_residency" | "soc2_encryption" | "hitl_governance" | "rls_isolation";
  statement: string;
  verified_at_iso: string;
}

export interface MerkleSelectiveProof {
  claim: ComplianceClaimLeaf;
  leaf_hash: string;
  root_hash: string;
  proof_steps: Array<{
    position: "left" | "right";
    sibling_hash: string;
  }>;
}

export interface RightToBeForgottenCertificate {
  certificate_id: string;
  tenant_id: string;
  subject_id: string;
  purged_records_count: number;
  redacted_audit_refs_count: number;
  erasure_timestamp_iso: string;
  certificate_sha256: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface PrivacyAccountant {
  configure(tenant: string, epsilon: number): void;
  consume(tenant: string, epsilon: number): number;
}
export interface SubjectErasureAdapter {
  store(record: { tenant_id: string; record_id: string; subject_id: string; data: string }): void;
  list(
    tenant: string,
    subject: string
  ): Array<{ record_id: string; subject_id: string; data: string }>;
  erase(tenant: string, subject: string): RightToBeForgottenCertificate;
}
export class KosmoraFinOpsComplianceEngine {
  private readonly banditArms = new Map<string, ProviderBanditArm>();

  constructor(
    private readonly privacyAccountant?: PrivacyAccountant,
    private readonly erasureAdapter?: SubjectErasureAdapter
  ) {}

  // ==========================================================================
  // F225-F230: Multi-Provider UCB1 / Beta-Bernoulli Bandit Pareto Model Router
  // ==========================================================================

  public registerProviderArm(params: {
    provider_id: string;
    model_id: string;
    ewma_latency_ms: number;
    cost_per_1k_usd: number;
  }): ProviderBanditArm {
    const arm: ProviderBanditArm = {
      provider_id: params.provider_id,
      model_id: params.model_id,
      successes_alpha: 2,
      failures_beta: 1,
      pulls_count: 1,
      ewma_latency_ms: params.ewma_latency_ms,
      cost_per_1k_usd: params.cost_per_1k_usd,
      circuit_open: false
    };
    this.banditArms.set(params.provider_id, arm);
    return arm;
  }

  public recordProviderBanditReward(params: {
    provider_id: string;
    succeeded: boolean;
    latency_ms: number;
  }): ProviderBanditArm {
    const arm = this.banditArms.get(params.provider_id);
    if (!arm) {
      throw new Error(`Provider arm '${params.provider_id}' not registered.`);
    }
    arm.pulls_count += 1;
    if (params.succeeded) {
      arm.successes_alpha += 1;
      arm.circuit_open = false;
    } else {
      arm.failures_beta += 1;
      if (arm.failures_beta / (arm.successes_alpha + arm.failures_beta) > 0.6) {
        arm.circuit_open = true;
      }
    }
    arm.ewma_latency_ms = Number((0.7 * arm.ewma_latency_ms + 0.3 * params.latency_ms).toFixed(2));
    return { ...arm };
  }

  public selectOptimalProviderBandit(params?: {
    max_latency_slo_ms?: number;
    cost_weight?: number;
  }): BanditRouteDecision {
    const maxSlo = params?.max_latency_slo_ms ?? 2000;
    const costWeight = params?.cost_weight ?? 15;
    const available = Array.from(this.banditArms.values()).filter(
      (a) => !a.circuit_open && a.ewma_latency_ms <= maxSlo
    );
    if (available.length === 0) {
      throw new Error("No healthy LLM provider arms meet the latency SLO.");
    }

    const totalPulls = available.reduce((acc, a) => acc + a.pulls_count, 0);
    const scored = available.map((arm) => {
      const winRate = arm.successes_alpha / (arm.successes_alpha + arm.failures_beta);
      const explorationBonus = Math.sqrt((2 * Math.log(totalPulls + 1)) / arm.pulls_count);
      const latencyPenalty = arm.ewma_latency_ms / 5000;
      const costPenalty = arm.cost_per_1k_usd * costWeight;
      const ucbScore = Number(
        (winRate + 0.15 * explorationBonus - latencyPenalty - costPenalty).toFixed(4)
      );
      return { arm, winRate: Number(winRate.toFixed(4)), ucbScore };
    });

    scored.sort((a, b) => b.ucbScore - a.ucbScore);
    const winner = scored[0]!;

    return {
      selected_provider_id: winner.arm.provider_id,
      selected_model_id: winner.arm.model_id,
      ucb_utility_score: winner.ucbScore,
      empirical_win_rate: winner.winRate,
      estimated_cost_per_1k_usd: winner.arm.cost_per_1k_usd,
      ranked_candidates: scored.map((s) => ({
        provider_id: s.arm.provider_id,
        model_id: s.arm.model_id,
        ucb_score: s.ucbScore
      }))
    };
  }

  // ==========================================================================
  // F231-F236: FinOps OLS Burn-Rate Forecaster & Z-Score Anomaly Detector
  // ==========================================================================

  public forecastTenantFinOpsBurnRate(params: {
    tenant_id: string;
    budget_cap_usd: number;
    hourly_spend_series: FinOpsSpendPoint[];
  }): FinOpsBurnForecast {
    if (params.hourly_spend_series.length < 2) {
      throw new Error("FinOps forecast requires at least 2 hourly spend observations.");
    }

    const n = params.hourly_spend_series.length;
    const xs = params.hourly_spend_series.map((p) => p.hour_index);
    const ys = params.hourly_spend_series.map((p) => p.spend_usd);

    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i]! - meanX) * (ys[i]! - meanY);
      den += (xs[i]! - meanX) ** 2;
    }
    const slope = den === 0 ? meanY : Math.max(0, num / den);
    const cumulativeSpend = ys.reduce((a, b) => a + b, 0);
    const remainingBudget = Math.max(0, params.budget_cap_usd - cumulativeSpend);

    // Z-score of latest observation vs prior baseline
    const baseline = ys.slice(0, -1);
    const baseMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const baseVar =
      baseline.reduce((acc, v) => acc + (v - baseMean) ** 2, 0) / Math.max(1, baseline.length);
    const baseStd = Math.sqrt(baseVar) || 0.01;
    const latestSpend = ys[ys.length - 1]!;
    const zScore = Number(((latestSpend - baseMean) / baseStd).toFixed(2));

    const effectiveHourlyBurn = Math.max(meanY, slope);
    const projectedHours =
      effectiveHourlyBurn > 0 ? Number((remainingBudget / effectiveHourlyBurn).toFixed(2)) : null;
    const anomalyDetected = zScore >= 2.5;

    return {
      tenant_id: params.tenant_id,
      current_cumulative_spend_usd: Number(cumulativeSpend.toFixed(4)),
      budget_cap_usd: params.budget_cap_usd,
      hourly_burn_slope_usd: Number(slope.toFixed(4)),
      projected_exhaustion_hours: projectedHours,
      anomaly_z_score: zScore,
      anomaly_detected: anomalyDetected,
      throttle_recommended: anomalyDetected || (projectedHours !== null && projectedHours < 12)
    };
  }

  // ==========================================================================
  // F237-F242: Differential Privacy (Epsilon) Laplace Mechanism & Accountant
  // ==========================================================================

  public configureTenantPrivacyBudget(tenantId: string, maxEpsilon: number): void {
    if (!this.privacyAccountant) throw Error("PRIVACY_ACCOUNTANT_UNAVAILABLE");
    if (!tenantId || !Number.isFinite(maxEpsilon) || maxEpsilon <= 0)
      throw Error("INVALID_PRIVACY_BUDGET");
    this.privacyAccountant.configure(tenantId, maxEpsilon);
  }

  public applyDifferentialPrivacyMechanism(params: {
    tenant_id: string;
    true_value: number;
    query_sensitivity: number;
    epsilon_cost: number;
    deterministic_seed?: string;
  }): DifferentialPrivacyResult {
    if (!this.privacyAccountant) throw Error("PRIVACY_ACCOUNTANT_UNAVAILABLE");
    if (params.deterministic_seed !== undefined)
      throw Error("CALLER_CONTROLLED_PRIVACY_RANDOMNESS_FORBIDDEN");
    if (
      !params.tenant_id ||
      ![params.true_value, params.query_sensitivity, params.epsilon_cost].every(Number.isFinite) ||
      params.query_sensitivity < 0 ||
      params.epsilon_cost <= 0
    )
      throw Error("INVALID_PRIVACY_INPUT");
    const b = params.query_sensitivity / params.epsilon_cost;
    if (!Number.isFinite(b)) throw Error("INVALID_PRIVACY_INPUT");
    const raw = Number(BigInt("0x" + randomBytes(7).toString("hex")) >> 3n);
    const u = Math.max(Number.EPSILON, Math.min(1 - Number.EPSILON, (raw + 0.5) / 2 ** 53)) - 0.5;
    const noise = -b * Math.sign(u) * Math.log1p(-2 * Math.abs(u));
    const value = params.true_value + noise;
    if (!Number.isFinite(value)) throw Error("INVALID_PRIVACY_INPUT");
    const remaining = this.privacyAccountant.consume(params.tenant_id, params.epsilon_cost);
    return {
      tenant_id: params.tenant_id,
      noised_value: value,
      epsilon_consumed: params.epsilon_cost,
      remaining_epsilon_budget: remaining,
      laplace_scale_b: b
    };
  }

  // ==========================================================================
  // F243-F248: Merkle-Tree Selective Disclosure Compliance Proofs
  // ==========================================================================

  public generateSelectiveDisclosureProof(
    claims: ComplianceClaimLeaf[],
    targetClaimId: string
  ): MerkleSelectiveProof {
    if (claims.length === 0) {
      throw new Error("Cannot build compliance Merkle tree from empty claims.");
    }
    const targetIdx = claims.findIndex((c) => c.claim_id === targetClaimId);
    if (targetIdx === -1) {
      throw new Error(`Claim '${targetClaimId}' not found in compliance set.`);
    }

    const leafHashes = claims.map((c) =>
      sha256Hex(`leaf:${c.claim_id}:${c.category}:${c.statement}:${c.verified_at_iso}`)
    );

    const proofSteps: MerkleSelectiveProof["proof_steps"] = [];
    let currentLayer = [...leafHashes];
    let currentIdx = targetIdx;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i]!;
        const right = currentLayer[i + 1] ?? left;
        if (i === currentIdx || i + 1 === currentIdx) {
          const isLeftNode = currentIdx % 2 === 0;
          proofSteps.push({
            position: isLeftNode ? "right" : "left",
            sibling_hash: isLeftNode ? right : left
          });
          currentIdx = Math.floor(i / 2);
        }
        nextLayer.push(sha256Hex(`node:${left}:${right}`));
      }
      currentLayer = nextLayer;
    }

    return {
      claim: claims[targetIdx]!,
      leaf_hash: leafHashes[targetIdx]!,
      root_hash: currentLayer[0]!,
      proof_steps: proofSteps
    };
  }

  public verifySelectiveDisclosureProof(proof: MerkleSelectiveProof): boolean {
    const recomputedLeaf = sha256Hex(
      `leaf:${proof.claim.claim_id}:${proof.claim.category}:${proof.claim.statement}:${proof.claim.verified_at_iso}`
    );
    if (recomputedLeaf !== proof.leaf_hash) {
      return false;
    }

    let currentHash = recomputedLeaf;
    for (const step of proof.proof_steps) {
      currentHash =
        step.position === "right"
          ? sha256Hex(`node:${currentHash}:${step.sibling_hash}`)
          : sha256Hex(`node:${step.sibling_hash}:${currentHash}`);
    }
    return currentHash === proof.root_hash;
  }

  // ==========================================================================
  // F249-F256: GDPR / 152-FZ Right-to-be-Forgotten Cascade & Erasure Certificate
  // ==========================================================================

  public storeSubjectDataRecord(params: {
    tenant_id: string;
    record_id: string;
    subject_id: string;
    data: string;
  }): void {
    if (!this.erasureAdapter) throw Error("SUBJECT_ERASURE_ADAPTER_UNAVAILABLE");
    this.erasureAdapter.store(structuredClone(params));
  }

  public executeRightToBeForgottenCascade(params: {
    tenant_id: string;
    subject_id: string;
  }): RightToBeForgottenCertificate {
    if (!this.erasureAdapter) throw Error("SUBJECT_ERASURE_ADAPTER_UNAVAILABLE");
    return this.erasureAdapter.erase(params.tenant_id, params.subject_id);
  }

  public listRemainingSubjectRecords(
    tenantId: string,
    subjectId: string
  ): Array<{ record_id: string; subject_id: string; data: string }> {
    if (!this.erasureAdapter) throw Error("SUBJECT_ERASURE_ADAPTER_UNAVAILABLE");
    return structuredClone(this.erasureAdapter.list(tenantId, subjectId));
  }
}
