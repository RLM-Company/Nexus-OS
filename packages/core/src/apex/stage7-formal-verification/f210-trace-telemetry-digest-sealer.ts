/**
 * F210 (stage7-formal-verification): Генератор криптографического слепка распределённой трассы
 * Фиксация структуры спанов, статусов и таймингов в неизменяемом SHA-256 дайджесте телеметрии
 * Operation Code: trace_telemetry_digest_sealer
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

export const F210_FEATURE_ID = "F210" as const;
export const F210_STAGE = "stage7-formal-verification" as const;
export const F210_OPERATION_CODE = "trace_telemetry_digest_sealer" as const;
export const F210_CONTRACT_VERSION = "2.0.0" as const;

export type F210TraceTelemetryDigestSealerConfig = BaseFeatureConfig<
  typeof F210_FEATURE_ID,
  typeof F210_STAGE,
  typeof F210_OPERATION_CODE
>;

export interface F210TraceTelemetryDigestSealerInput extends BaseFeatureInput {
  readonly trace_id: string | number | boolean | readonly string[];
  readonly span_count: string | number | boolean | readonly string[];
  readonly trace_digest: string | number | boolean | readonly string[];
  readonly sealed_status: string | number | boolean | readonly string[];
}

export interface F210TraceTelemetryDigestSealerOutput {
  readonly featureId: typeof F210_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F210_OPERATION_CODE;
  readonly resolved_trace_id: unknown;
  readonly resolved_span_count: unknown;
  readonly resolved_trace_digest: unknown;
  readonly resolved_sealed_status: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F210_FEATURE_ID>;
}

export type F210TraceTelemetryDigestSealerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F210_FEATURE_ID
>;

export const DEFAULT_F210_CONFIG: F210TraceTelemetryDigestSealerConfig = {
  featureId: F210_FEATURE_ID,
  stage: F210_STAGE,
  operationCode: F210_OPERATION_CODE,
  contractVersion: F210_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F210TraceTelemetryDigestSealerValidationError extends Error {
  public readonly featureId = F210_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F210 Validation Error on '${field}']: ${message}`);
    this.name = "F210TraceTelemetryDigestSealerValidationError";
    this.field = field;
  }
}

export function computeF210Digest(rawPayload: string): string {
  return `f210_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F210TraceTelemetryDigestSealerService extends KosmoraFeatureAdapterBase<
  typeof F210_FEATURE_ID,
  typeof F210_STAGE,
  typeof F210_OPERATION_CODE,
  F210TraceTelemetryDigestSealerConfig,
  F210TraceTelemetryDigestSealerInput,
  F210TraceTelemetryDigestSealerOutput
> {
  constructor(
    customConfig?: Partial<F210TraceTelemetryDigestSealerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F210_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["trace_id", "span_count", "trace_digest", "sealed_status"] as const,
      F210TraceTelemetryDigestSealerValidationError
    );
  }
}

export function verifyF210Module(): {
  readonly featureId: typeof F210_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F210TraceTelemetryDigestSealerService();
  const sampleInput: F210TraceTelemetryDigestSealerInput = {
    requestId: "req_verify_f210",
    projectId: "proj_kosmora_f210",
    workspaceId: "ws_kosmora_f210",
    tenantId: "tenant_rlm_f210",
    actorId: "actor_verifier_f210",
    autonomyLevel: "A3",
    trace_id: "seed_f210_trace_id",
    span_count: 42,
    trace_digest: true,
    sealed_status: "seed_f210_sealed_status",
    metadata: { stage: "stage7-formal-verification", featureId: "F210" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F210" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F210] Verification failed`);
  }

  return {
    featureId: F210_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
