/**
 * F318 (stage10-game-theory): Диспетчер переназначения свободных задач при асимметричных пулах
 * Безопасная маршрутизация нераспределённых задач в резервный контур исполнения
 * Operation Code: galeshapley_unmatched_fallback
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

export const F318_FEATURE_ID = "F318" as const;
export const F318_STAGE = "stage10-game-theory" as const;
export const F318_OPERATION_CODE = "galeshapley_unmatched_fallback" as const;
export const F318_CONTRACT_VERSION = "2.0.0" as const;

export type F318GaleShapleyUnmatchedFallbackReassignerConfig = BaseFeatureConfig<
  typeof F318_FEATURE_ID,
  typeof F318_STAGE,
  typeof F318_OPERATION_CODE
>;

export interface F318GaleShapleyUnmatchedFallbackReassignerInput extends BaseFeatureInput {
  readonly unmatched_agent_ids: string | number | boolean | readonly string[];
  readonly unmatched_task_ids: string | number | boolean | readonly string[];
  readonly fallback_queue: string | number | boolean | readonly string[];
  readonly escalation_target: string | number | boolean | readonly string[];
}

export interface F318GaleShapleyUnmatchedFallbackReassignerOutput {
  readonly featureId: typeof F318_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F318_OPERATION_CODE;
  readonly resolved_unmatched_agent_ids: unknown;
  readonly resolved_unmatched_task_ids: unknown;
  readonly resolved_fallback_queue: unknown;
  readonly resolved_escalation_target: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F318_FEATURE_ID>;
}

export type F318GaleShapleyUnmatchedFallbackReassignerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F318_FEATURE_ID
>;

export const DEFAULT_F318_CONFIG: F318GaleShapleyUnmatchedFallbackReassignerConfig = {
  featureId: F318_FEATURE_ID,
  stage: F318_STAGE,
  operationCode: F318_OPERATION_CODE,
  contractVersion: F318_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F318GaleShapleyUnmatchedFallbackReassignerValidationError extends Error {
  public readonly featureId = F318_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F318 Validation Error on '${field}']: ${message}`);
    this.name = "F318GaleShapleyUnmatchedFallbackReassignerValidationError";
    this.field = field;
  }
}

export function computeF318Digest(rawPayload: string): string {
  return `f318_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F318GaleShapleyUnmatchedFallbackReassignerService extends KosmoraFeatureAdapterBase<
  typeof F318_FEATURE_ID,
  typeof F318_STAGE,
  typeof F318_OPERATION_CODE,
  F318GaleShapleyUnmatchedFallbackReassignerConfig,
  F318GaleShapleyUnmatchedFallbackReassignerInput,
  F318GaleShapleyUnmatchedFallbackReassignerOutput
> {
  constructor(
    customConfig?: Partial<F318GaleShapleyUnmatchedFallbackReassignerConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F318_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["unmatched_agent_ids", "unmatched_task_ids", "fallback_queue", "escalation_target"] as const,
      F318GaleShapleyUnmatchedFallbackReassignerValidationError
    );
  }
}

export function verifyF318Module(): {
  readonly featureId: typeof F318_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F318GaleShapleyUnmatchedFallbackReassignerService();
  const sampleInput: F318GaleShapleyUnmatchedFallbackReassignerInput = {
    requestId: "req_verify_f318",
    projectId: "proj_kosmora_f318",
    workspaceId: "ws_kosmora_f318",
    tenantId: "tenant_rlm_f318",
    actorId: "actor_verifier_f318",
    autonomyLevel: "A3",
    unmatched_agent_ids: "seed_f318_unmatched_agent_ids",
    unmatched_task_ids: 42,
    fallback_queue: true,
    escalation_target: "seed_f318_escalation_target",
    metadata: { stage: "stage10-game-theory", featureId: "F318" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F318" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_unmatched_agent_ids !== sampleInput.unmatched_agent_ids &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F318] Verification failed`);
  }

  return {
    featureId: F318_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
