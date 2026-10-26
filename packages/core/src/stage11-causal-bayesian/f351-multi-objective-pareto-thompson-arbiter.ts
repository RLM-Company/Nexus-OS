/**
 * F351 (stage11-causal-bayesian): Многокритериальный арбитр Томпсона (точность + задержка + стоимость)
 * Взвешенная агрегация апостериорных выборок для выбора Парето-эффективной стратегии
 * Operation Code: thompson_pareto_arbiter
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F351_FEATURE_ID = "F351" as const;
export const F351_STAGE = "stage11-causal-bayesian" as const;
export const F351_OPERATION_CODE = "thompson_pareto_arbiter" as const;
export const F351_CONTRACT_VERSION = "2.0.0" as const;

export type F351MultiObjectiveParetoThompsonArbiterConfig = BaseFeatureConfig<
  typeof F351_FEATURE_ID,
  typeof F351_STAGE,
  typeof F351_OPERATION_CODE
>;

export interface F351MultiObjectiveParetoThompsonArbiterInput extends BaseFeatureInput {
  readonly selected_arm_id: string | number | boolean | readonly string[];
  readonly composite_theta: string | number | boolean | readonly string[];
  readonly latency_penalty: string | number | boolean | readonly string[];
  readonly pareto_optimal: string | number | boolean | readonly string[];
}

export interface F351MultiObjectiveParetoThompsonArbiterOutput {
  readonly featureId: typeof F351_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F351_OPERATION_CODE;
  readonly resolved_selected_arm_id: unknown;
  readonly resolved_composite_theta: unknown;
  readonly resolved_latency_penalty: unknown;
  readonly resolved_pareto_optimal: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F351_FEATURE_ID>;
}

export type F351MultiObjectiveParetoThompsonArbiterTelemetrySnapshot = BaseFeatureTelemetry<typeof F351_FEATURE_ID>;

export const DEFAULT_F351_CONFIG: F351MultiObjectiveParetoThompsonArbiterConfig = {
  featureId: F351_FEATURE_ID,
  stage: F351_STAGE,
  operationCode: F351_OPERATION_CODE,
  contractVersion: F351_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F351MultiObjectiveParetoThompsonArbiterValidationError extends Error {
  public readonly featureId = F351_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F351 Validation Error on '${field}']: ${message}`);
    this.name = "F351MultiObjectiveParetoThompsonArbiterValidationError";
    this.field = field;
  }
}

export function computeF351Digest(rawPayload: string): string {
  return `f351_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F351MultiObjectiveParetoThompsonArbiterService extends KosmoraFeatureAdapterBase<
  typeof F351_FEATURE_ID,
  typeof F351_STAGE,
  typeof F351_OPERATION_CODE,
  F351MultiObjectiveParetoThompsonArbiterConfig,
  F351MultiObjectiveParetoThompsonArbiterInput,
  F351MultiObjectiveParetoThompsonArbiterOutput
> {
  constructor(customConfig?: Partial<F351MultiObjectiveParetoThompsonArbiterConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F351_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["selected_arm_id", "composite_theta", "latency_penalty", "pareto_optimal"] as const,
      F351MultiObjectiveParetoThompsonArbiterValidationError
    );
  }
}

export function verifyF351Module(): {
  readonly featureId: typeof F351_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F351MultiObjectiveParetoThompsonArbiterService();
  const sampleInput: F351MultiObjectiveParetoThompsonArbiterInput = {
    requestId: "req_verify_f351",
    projectId: "proj_kosmora_f351",
    workspaceId: "ws_kosmora_f351",
    tenantId: "tenant_rlm_f351",
    actorId: "actor_verifier_f351",
    autonomyLevel: "A3",
    selected_arm_id: "seed_f351_selected_arm_id",
    composite_theta: 42,
    latency_penalty: true,
    pareto_optimal: "seed_f351_pareto_optimal",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F351" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F351" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selected_arm_id !== sampleInput.selected_arm_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F351] Verification failed`);
  }

  return {
    featureId: F351_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
