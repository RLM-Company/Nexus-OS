/**
 * F349 (stage11-causal-bayesian): Монитор накопленного байесовского сожаления (Cumulative Bayesian Regret)
 * Контроль сходимости сэмплирования Томпсона к теоретическому логарифмическому пределу
 * Operation Code: thompson_regret_monitor
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

export const F349_FEATURE_ID = "F349" as const;
export const F349_STAGE = "stage11-causal-bayesian" as const;
export const F349_OPERATION_CODE = "thompson_regret_monitor" as const;
export const F349_CONTRACT_VERSION = "2.0.0" as const;

export type F349BayesianRegretBoundMonitorConfig = BaseFeatureConfig<
  typeof F349_FEATURE_ID,
  typeof F349_STAGE,
  typeof F349_OPERATION_CODE
>;

export interface F349BayesianRegretBoundMonitorInput extends BaseFeatureInput {
  readonly total_rounds: string | number | boolean | readonly string[];
  readonly cumulative_regret: string | number | boolean | readonly string[];
  readonly sublinear_verified: string | number | boolean | readonly string[];
  readonly optimal_arm_share: string | number | boolean | readonly string[];
}

export interface F349BayesianRegretBoundMonitorOutput {
  readonly featureId: typeof F349_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F349_OPERATION_CODE;
  readonly resolved_total_rounds: unknown;
  readonly resolved_cumulative_regret: unknown;
  readonly resolved_sublinear_verified: unknown;
  readonly resolved_optimal_arm_share: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F349_FEATURE_ID>;
}

export type F349BayesianRegretBoundMonitorTelemetrySnapshot = BaseFeatureTelemetry<typeof F349_FEATURE_ID>;

export const DEFAULT_F349_CONFIG: F349BayesianRegretBoundMonitorConfig = {
  featureId: F349_FEATURE_ID,
  stage: F349_STAGE,
  operationCode: F349_OPERATION_CODE,
  contractVersion: F349_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F349BayesianRegretBoundMonitorValidationError extends Error {
  public readonly featureId = F349_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F349 Validation Error on '${field}']: ${message}`);
    this.name = "F349BayesianRegretBoundMonitorValidationError";
    this.field = field;
  }
}

export function computeF349Digest(rawPayload: string): string {
  return `f349_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F349BayesianRegretBoundMonitorService extends KosmoraFeatureAdapterBase<
  typeof F349_FEATURE_ID,
  typeof F349_STAGE,
  typeof F349_OPERATION_CODE,
  F349BayesianRegretBoundMonitorConfig,
  F349BayesianRegretBoundMonitorInput,
  F349BayesianRegretBoundMonitorOutput
> {
  constructor(customConfig?: Partial<F349BayesianRegretBoundMonitorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F349_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["total_rounds", "cumulative_regret", "sublinear_verified", "optimal_arm_share"] as const,
      F349BayesianRegretBoundMonitorValidationError
    );
  }
}

export function verifyF349Module(): {
  readonly featureId: typeof F349_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F349BayesianRegretBoundMonitorService();
  const sampleInput: F349BayesianRegretBoundMonitorInput = {
    requestId: "req_verify_f349",
    projectId: "proj_kosmora_f349",
    workspaceId: "ws_kosmora_f349",
    tenantId: "tenant_rlm_f349",
    actorId: "actor_verifier_f349",
    autonomyLevel: "A3",
    total_rounds: "seed_f349_total_rounds",
    cumulative_regret: 42,
    sublinear_verified: true,
    optimal_arm_share: "seed_f349_optimal_arm_share",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F349" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F349" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_total_rounds !== sampleInput.total_rounds &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F349] Verification failed`);
  }

  return {
    featureId: F349_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
