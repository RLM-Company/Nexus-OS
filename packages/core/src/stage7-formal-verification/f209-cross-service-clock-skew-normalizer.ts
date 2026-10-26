/**
 * F209 (stage7-formal-verification): Корректор рассинхронизации часов между узлами при анализе трасс
 * Нормализация временных меток старта и завершения спанов для точного расчёта длительности прогона
 * Operation Code: cross_service_clock_skew_normalizer
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

export const F209_FEATURE_ID = "F209" as const;
export const F209_STAGE = "stage7-formal-verification" as const;
export const F209_OPERATION_CODE = "cross_service_clock_skew_normalizer" as const;
export const F209_CONTRACT_VERSION = "2.0.0" as const;

export type F209CrossServiceClockSkewNormalizerConfig = BaseFeatureConfig<
  typeof F209_FEATURE_ID,
  typeof F209_STAGE,
  typeof F209_OPERATION_CODE
>;

export interface F209CrossServiceClockSkewNormalizerInput extends BaseFeatureInput {
  readonly trace_id: string | number | boolean | readonly string[];
  readonly total_duration_ms: string | number | boolean | readonly string[];
  readonly critical_path_ms: string | number | boolean | readonly string[];
  readonly normalized_ok: string | number | boolean | readonly string[];
}

export interface F209CrossServiceClockSkewNormalizerOutput {
  readonly featureId: typeof F209_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F209_OPERATION_CODE;
  readonly resolved_trace_id: unknown;
  readonly resolved_total_duration_ms: unknown;
  readonly resolved_critical_path_ms: unknown;
  readonly resolved_normalized_ok: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F209_FEATURE_ID>;
}

export type F209CrossServiceClockSkewNormalizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F209_FEATURE_ID>;

export const DEFAULT_F209_CONFIG: F209CrossServiceClockSkewNormalizerConfig = {
  featureId: F209_FEATURE_ID,
  stage: F209_STAGE,
  operationCode: F209_OPERATION_CODE,
  contractVersion: F209_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F209CrossServiceClockSkewNormalizerValidationError extends Error {
  public readonly featureId = F209_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F209 Validation Error on '${field}']: ${message}`);
    this.name = "F209CrossServiceClockSkewNormalizerValidationError";
    this.field = field;
  }
}

export function computeF209Digest(rawPayload: string): string {
  return `f209_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F209CrossServiceClockSkewNormalizerService extends KosmoraFeatureAdapterBase<
  typeof F209_FEATURE_ID,
  typeof F209_STAGE,
  typeof F209_OPERATION_CODE,
  F209CrossServiceClockSkewNormalizerConfig,
  F209CrossServiceClockSkewNormalizerInput,
  F209CrossServiceClockSkewNormalizerOutput
> {
  constructor(customConfig?: Partial<F209CrossServiceClockSkewNormalizerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F209_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["trace_id", "total_duration_ms", "critical_path_ms", "normalized_ok"] as const,
      F209CrossServiceClockSkewNormalizerValidationError
    );
  }
}

export function verifyF209Module(): {
  readonly featureId: typeof F209_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F209CrossServiceClockSkewNormalizerService();
  const sampleInput: F209CrossServiceClockSkewNormalizerInput = {
    requestId: "req_verify_f209",
    projectId: "proj_kosmora_f209",
    workspaceId: "ws_kosmora_f209",
    tenantId: "tenant_rlm_f209",
    actorId: "actor_verifier_f209",
    autonomyLevel: "A3",
    trace_id: "seed_f209_trace_id",
    total_duration_ms: 42,
    critical_path_ms: true,
    normalized_ok: "seed_f209_normalized_ok",
    metadata: { stage: "stage7-formal-verification", featureId: "F209" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F209" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F209] Verification failed`);
  }

  return {
    featureId: F209_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
