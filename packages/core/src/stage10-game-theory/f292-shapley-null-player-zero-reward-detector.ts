/**
 * F292 (stage10-game-theory): Детектор нулевых игроков (Null Player Axiom Guard)
 * Идентификация агентов с нулевым предельным вкладом во все коалиции для отсечения паразитных вызовов
 * Operation Code: shapley_null_player_detect
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
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F292_FEATURE_ID = "F292" as const;
export const F292_STAGE = "stage10-game-theory" as const;
export const F292_OPERATION_CODE = "shapley_null_player_detect" as const;
export const F292_CONTRACT_VERSION = "2.0.0" as const;

export type F292ShapleyNullPlayerZeroRewardDetectorConfig = BaseFeatureConfig<
  typeof F292_FEATURE_ID,
  typeof F292_STAGE,
  typeof F292_OPERATION_CODE
>;

export interface F292ShapleyNullPlayerZeroRewardDetectorInput extends BaseFeatureInput {
  readonly agent_contributions: string | number | boolean | readonly string[];
  readonly marginal_deltas: string | number | boolean | readonly string[];
  readonly zero_threshold: string | number | boolean | readonly string[];
  readonly pruning_policy: string | number | boolean | readonly string[];
}

export interface F292ShapleyNullPlayerZeroRewardDetectorOutput {
  readonly featureId: typeof F292_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F292_OPERATION_CODE;
  readonly resolved_agent_contributions: unknown;
  readonly resolved_marginal_deltas: unknown;
  readonly resolved_zero_threshold: unknown;
  readonly resolved_pruning_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F292_FEATURE_ID>;
}

export type F292ShapleyNullPlayerZeroRewardDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F292_FEATURE_ID>;

export const DEFAULT_F292_CONFIG: F292ShapleyNullPlayerZeroRewardDetectorConfig = {
  featureId: F292_FEATURE_ID,
  stage: F292_STAGE,
  operationCode: F292_OPERATION_CODE,
  contractVersion: F292_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F292ShapleyNullPlayerZeroRewardDetectorValidationError extends Error {
  public readonly featureId = F292_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F292 Validation Error on '${field}']: ${message}`);
    this.name = "F292ShapleyNullPlayerZeroRewardDetectorValidationError";
    this.field = field;
  }
}

export function computeF292Digest(rawPayload: string): string {
  return `f292_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F292ShapleyNullPlayerZeroRewardDetectorService extends KosmoraFeatureAdapterBase<
  typeof F292_FEATURE_ID,
  typeof F292_STAGE,
  typeof F292_OPERATION_CODE,
  F292ShapleyNullPlayerZeroRewardDetectorConfig,
  F292ShapleyNullPlayerZeroRewardDetectorInput,
  F292ShapleyNullPlayerZeroRewardDetectorOutput
> {
  constructor(customConfig?: Partial<F292ShapleyNullPlayerZeroRewardDetectorConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F292_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["agent_contributions", "marginal_deltas", "zero_threshold", "pruning_policy"] as const,
      F292ShapleyNullPlayerZeroRewardDetectorValidationError
    );
  }
}

export function verifyF292Module(): {
  readonly featureId: typeof F292_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F292ShapleyNullPlayerZeroRewardDetectorService();
  const sampleInput: F292ShapleyNullPlayerZeroRewardDetectorInput = {
    requestId: "req_verify_f292",
    projectId: "proj_kosmora_f292",
    workspaceId: "ws_kosmora_f292",
    tenantId: "tenant_rlm_f292",
    actorId: "actor_verifier_f292",
    autonomyLevel: "A3",
    agent_contributions: "seed_f292_agent_contributions",
    marginal_deltas: 42,
    zero_threshold: true,
    pruning_policy: "seed_f292_pruning_policy",
    metadata: { stage: "stage10-game-theory", featureId: "F292" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F292" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_contributions !== sampleInput.agent_contributions &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F292] Verification failed`);
  }

  return {
    featureId: F292_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
