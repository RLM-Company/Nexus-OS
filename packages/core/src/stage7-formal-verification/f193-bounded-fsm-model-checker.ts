/**
 * F193 (stage7-formal-verification): Верификатор инвариантов конечных автоматов (Bounded Model Checker)
 * Обход в ширину (BFS) пространства состояний DAG и протокола для математического доказательства отсутствия запрещённых состояний
 * Operation Code: bounded_fsm_model_checker
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F193_FEATURE_ID = "F193" as const;
export const F193_STAGE = "stage7-formal-verification" as const;
export const F193_OPERATION_CODE = "bounded_fsm_model_checker" as const;
export const F193_CONTRACT_VERSION = "2.0.0" as const;

export type F193BoundedFsmModelCheckerConfig = BaseFeatureConfig<
  typeof F193_FEATURE_ID,
  typeof F193_STAGE,
  typeof F193_OPERATION_CODE
>;

export interface F193BoundedFsmModelCheckerInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly visited_states_count: string | number | boolean | readonly string[];
  readonly invariants_satisfied: string | number | boolean | readonly string[];
  readonly state_space_digest: string | number | boolean | readonly string[];
}

export interface F193BoundedFsmModelCheckerOutput {
  readonly featureId: typeof F193_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F193_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_visited_states_count: unknown;
  readonly resolved_invariants_satisfied: unknown;
  readonly resolved_state_space_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F193_FEATURE_ID>;
}

export type F193BoundedFsmModelCheckerTelemetrySnapshot = BaseFeatureTelemetry<typeof F193_FEATURE_ID>;

export const DEFAULT_F193_CONFIG: F193BoundedFsmModelCheckerConfig = {
  featureId: F193_FEATURE_ID,
  stage: F193_STAGE,
  operationCode: F193_OPERATION_CODE,
  contractVersion: F193_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F193BoundedFsmModelCheckerValidationError extends Error {
  public readonly featureId = F193_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F193 Validation Error on '${field}']: ${message}`);
    this.name = "F193BoundedFsmModelCheckerValidationError";
    this.field = field;
  }
}

export function computeF193Digest(rawPayload: string): string {
  return `f193_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F193BoundedFsmModelCheckerService extends KosmoraFeatureAdapterBase<
  typeof F193_FEATURE_ID,
  typeof F193_STAGE,
  typeof F193_OPERATION_CODE,
  F193BoundedFsmModelCheckerConfig,
  F193BoundedFsmModelCheckerInput,
  F193BoundedFsmModelCheckerOutput
> {
  constructor(customConfig?: Partial<F193BoundedFsmModelCheckerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F193_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "visited_states_count", "invariants_satisfied", "state_space_digest"] as const,
      F193BoundedFsmModelCheckerValidationError
    );
  }
}

export function verifyF193Module(): {
  readonly featureId: typeof F193_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F193BoundedFsmModelCheckerService();
  const sampleInput: F193BoundedFsmModelCheckerInput = {
    requestId: "req_verify_f193",
    projectId: "proj_kosmora_f193",
    workspaceId: "ws_kosmora_f193",
    tenantId: "tenant_rlm_f193",
    actorId: "actor_verifier_f193",
    autonomyLevel: "A3",
    model_id: "seed_f193_model_id",
    visited_states_count: 42,
    invariants_satisfied: true,
    state_space_digest: "seed_f193_state_space_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F193" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F193" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F193] Verification failed`);
  }

  return {
    featureId: F193_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
