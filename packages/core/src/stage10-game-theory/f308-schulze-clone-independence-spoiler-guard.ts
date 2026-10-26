/**
 * F308 (stage10-game-theory): Защитник независимости от клонов-спойлеров (Independence of Clones)
 * Гарантия того, что добавление схожих вариантов ответа не искажает выбор лучшего плана
 * Operation Code: schulze_clone_guard
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

export const F308_FEATURE_ID = "F308" as const;
export const F308_STAGE = "stage10-game-theory" as const;
export const F308_OPERATION_CODE = "schulze_clone_guard" as const;
export const F308_CONTRACT_VERSION = "2.0.0" as const;

export type F308SchulzeCloneIndependenceSpoilerGuardConfig = BaseFeatureConfig<
  typeof F308_FEATURE_ID,
  typeof F308_STAGE,
  typeof F308_OPERATION_CODE
>;

export interface F308SchulzeCloneIndependenceSpoilerGuardInput extends BaseFeatureInput {
  readonly original_candidates: string | number | boolean | readonly string[];
  readonly cloned_candidate_set: string | number | boolean | readonly string[];
  readonly ranking_before: string | number | boolean | readonly string[];
  readonly ranking_after: string | number | boolean | readonly string[];
}

export interface F308SchulzeCloneIndependenceSpoilerGuardOutput {
  readonly featureId: typeof F308_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F308_OPERATION_CODE;
  readonly resolved_original_candidates: unknown;
  readonly resolved_cloned_candidate_set: unknown;
  readonly resolved_ranking_before: unknown;
  readonly resolved_ranking_after: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F308_FEATURE_ID>;
}

export type F308SchulzeCloneIndependenceSpoilerGuardTelemetrySnapshot = BaseFeatureTelemetry<typeof F308_FEATURE_ID>;

export const DEFAULT_F308_CONFIG: F308SchulzeCloneIndependenceSpoilerGuardConfig = {
  featureId: F308_FEATURE_ID,
  stage: F308_STAGE,
  operationCode: F308_OPERATION_CODE,
  contractVersion: F308_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F308SchulzeCloneIndependenceSpoilerGuardValidationError extends Error {
  public readonly featureId = F308_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F308 Validation Error on '${field}']: ${message}`);
    this.name = "F308SchulzeCloneIndependenceSpoilerGuardValidationError";
    this.field = field;
  }
}

export function computeF308Digest(rawPayload: string): string {
  return `f308_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F308SchulzeCloneIndependenceSpoilerGuardService extends KosmoraFeatureAdapterBase<
  typeof F308_FEATURE_ID,
  typeof F308_STAGE,
  typeof F308_OPERATION_CODE,
  F308SchulzeCloneIndependenceSpoilerGuardConfig,
  F308SchulzeCloneIndependenceSpoilerGuardInput,
  F308SchulzeCloneIndependenceSpoilerGuardOutput
> {
  constructor(customConfig?: Partial<F308SchulzeCloneIndependenceSpoilerGuardConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F308_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["original_candidates", "cloned_candidate_set", "ranking_before", "ranking_after"] as const,
      F308SchulzeCloneIndependenceSpoilerGuardValidationError
    );
  }
}

export function verifyF308Module(): {
  readonly featureId: typeof F308_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F308SchulzeCloneIndependenceSpoilerGuardService();
  const sampleInput: F308SchulzeCloneIndependenceSpoilerGuardInput = {
    requestId: "req_verify_f308",
    projectId: "proj_kosmora_f308",
    workspaceId: "ws_kosmora_f308",
    tenantId: "tenant_rlm_f308",
    actorId: "actor_verifier_f308",
    autonomyLevel: "A3",
    original_candidates: "seed_f308_original_candidates",
    cloned_candidate_set: 42,
    ranking_before: true,
    ranking_after: "seed_f308_ranking_after",
    metadata: { stage: "stage10-game-theory", featureId: "F308" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F308" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_original_candidates !== sampleInput.original_candidates &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F308] Verification failed`);
  }

  return {
    featureId: F308_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
