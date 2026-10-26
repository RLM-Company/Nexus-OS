/**
 * F254 (stage8-finops-compliance): Идемпотентный обработчик повторных запросов на удаление данных субъекта
 * Корректный выпуск подтверждающего сертификата при повторном обращении после уже выполненной зачистки
 * Operation Code: idempotent_erasure_replay_handler
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F254_FEATURE_ID = "F254" as const;
export const F254_STAGE = "stage8-finops-compliance" as const;
export const F254_OPERATION_CODE = "idempotent_erasure_replay_handler" as const;
export const F254_CONTRACT_VERSION = "2.0.0" as const;

export type F254IdempotentErasureReplayHandlerConfig = BaseFeatureConfig<
  typeof F254_FEATURE_ID,
  typeof F254_STAGE,
  typeof F254_OPERATION_CODE
>;

export interface F254IdempotentErasureReplayHandlerInput extends BaseFeatureInput {
  readonly first_purged_count: string | number | boolean | readonly string[];
  readonly second_purged_count: string | number | boolean | readonly string[];
  readonly idempotent_safe: string | number | boolean | readonly string[];
  readonly certificate_signature: string | number | boolean | readonly string[];
}

export interface F254IdempotentErasureReplayHandlerOutput {
  readonly featureId: typeof F254_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F254_OPERATION_CODE;
  readonly resolved_first_purged_count: unknown;
  readonly resolved_second_purged_count: unknown;
  readonly resolved_idempotent_safe: unknown;
  readonly resolved_certificate_signature: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F254_FEATURE_ID>;
}

export type F254IdempotentErasureReplayHandlerTelemetrySnapshot = BaseFeatureTelemetry<typeof F254_FEATURE_ID>;

export const DEFAULT_F254_CONFIG: F254IdempotentErasureReplayHandlerConfig = {
  featureId: F254_FEATURE_ID,
  stage: F254_STAGE,
  operationCode: F254_OPERATION_CODE,
  contractVersion: F254_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F254IdempotentErasureReplayHandlerValidationError extends Error {
  public readonly featureId = F254_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F254 Validation Error on '${field}']: ${message}`);
    this.name = "F254IdempotentErasureReplayHandlerValidationError";
    this.field = field;
  }
}

export function computeF254Digest(rawPayload: string): string {
  return `f254_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F254IdempotentErasureReplayHandlerService extends KosmoraFeatureAdapterBase<
  typeof F254_FEATURE_ID,
  typeof F254_STAGE,
  typeof F254_OPERATION_CODE,
  F254IdempotentErasureReplayHandlerConfig,
  F254IdempotentErasureReplayHandlerInput,
  F254IdempotentErasureReplayHandlerOutput
> {
  constructor(customConfig?: Partial<F254IdempotentErasureReplayHandlerConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F254_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["first_purged_count", "second_purged_count", "idempotent_safe", "certificate_signature"] as const,
      F254IdempotentErasureReplayHandlerValidationError
    );
  }
}

export function verifyF254Module(): {
  readonly featureId: typeof F254_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F254IdempotentErasureReplayHandlerService();
  const sampleInput: F254IdempotentErasureReplayHandlerInput = {
    requestId: "req_verify_f254",
    projectId: "proj_kosmora_f254",
    workspaceId: "ws_kosmora_f254",
    tenantId: "tenant_rlm_f254",
    actorId: "actor_verifier_f254",
    autonomyLevel: "A3",
    first_purged_count: "seed_f254_first_purged_count",
    second_purged_count: 42,
    idempotent_safe: true,
    certificate_signature: "seed_f254_certificate_signature",
    metadata: { stage: "stage8-finops-compliance", featureId: "F254" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F254" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_first_purged_count !== sampleInput.first_purged_count &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F254] Verification failed`);
  }

  return {
    featureId: F254_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
