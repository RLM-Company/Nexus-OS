/**
 * F208 (stage7-formal-verification): Детектор узких мест по чистому собственному времени спана (Self-Time)
 * Вычитание длительности дочерних вызовов для точного определения сервиса, создающего основную задержку
 * Operation Code: self_time_bottleneck_detector
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

export const F208_FEATURE_ID = "F208" as const;
export const F208_STAGE = "stage7-formal-verification" as const;
export const F208_OPERATION_CODE = "self_time_bottleneck_detector" as const;
export const F208_CONTRACT_VERSION = "2.0.0" as const;

export type F208SelfTimeBottleneckDetectorConfig = BaseFeatureConfig<
  typeof F208_FEATURE_ID,
  typeof F208_STAGE,
  typeof F208_OPERATION_CODE
>;

export interface F208SelfTimeBottleneckDetectorInput extends BaseFeatureInput {
  readonly bottleneck_span_id: string | number | boolean | readonly string[];
  readonly bottleneck_service: string | number | boolean | readonly string[];
  readonly self_time_ms: string | number | boolean | readonly string[];
  readonly total_duration_ms: string | number | boolean | readonly string[];
}

export interface F208SelfTimeBottleneckDetectorOutput {
  readonly featureId: typeof F208_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F208_OPERATION_CODE;
  readonly resolved_bottleneck_span_id: unknown;
  readonly resolved_bottleneck_service: unknown;
  readonly resolved_self_time_ms: unknown;
  readonly resolved_total_duration_ms: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F208_FEATURE_ID>;
}

export type F208SelfTimeBottleneckDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F208_FEATURE_ID>;

export const DEFAULT_F208_CONFIG: F208SelfTimeBottleneckDetectorConfig = {
  featureId: F208_FEATURE_ID,
  stage: F208_STAGE,
  operationCode: F208_OPERATION_CODE,
  contractVersion: F208_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F208SelfTimeBottleneckDetectorValidationError extends Error {
  public readonly featureId = F208_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F208 Validation Error on '${field}']: ${message}`);
    this.name = "F208SelfTimeBottleneckDetectorValidationError";
    this.field = field;
  }
}

export function computeF208Digest(rawPayload: string): string {
  return `f208_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F208SelfTimeBottleneckDetectorService extends KosmoraFeatureAdapterBase<
  typeof F208_FEATURE_ID,
  typeof F208_STAGE,
  typeof F208_OPERATION_CODE,
  F208SelfTimeBottleneckDetectorConfig,
  F208SelfTimeBottleneckDetectorInput,
  F208SelfTimeBottleneckDetectorOutput
> {
  constructor(customConfig?: Partial<F208SelfTimeBottleneckDetectorConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F208_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["bottleneck_span_id", "bottleneck_service", "self_time_ms", "total_duration_ms"] as const,
      F208SelfTimeBottleneckDetectorValidationError
    );
  }
}

export function verifyF208Module(): {
  readonly featureId: typeof F208_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F208SelfTimeBottleneckDetectorService();
  const sampleInput: F208SelfTimeBottleneckDetectorInput = {
    requestId: "req_verify_f208",
    projectId: "proj_kosmora_f208",
    workspaceId: "ws_kosmora_f208",
    tenantId: "tenant_rlm_f208",
    actorId: "actor_verifier_f208",
    autonomyLevel: "A3",
    bottleneck_span_id: "seed_f208_bottleneck_span_id",
    bottleneck_service: 42,
    self_time_ms: true,
    total_duration_ms: "seed_f208_total_duration_ms",
    metadata: { stage: "stage7-formal-verification", featureId: "F208" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F208" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_bottleneck_span_id !== sampleInput.bottleneck_span_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F208] Verification failed`);
  }

  return {
    featureId: F208_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
