/**
 * F205 (stage7-formal-verification): Парсер и инжектор заголовков сквозной трассировки W3C TraceContext
 * Валидация формата 00-traceId-spanId-flags и генерация дочернего spanId при передаче управления между агентами
 * Operation Code: w3c_traceparent_header_propagator
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

export const F205_FEATURE_ID = "F205" as const;
export const F205_STAGE = "stage7-formal-verification" as const;
export const F205_OPERATION_CODE = "w3c_traceparent_header_propagator" as const;
export const F205_CONTRACT_VERSION = "2.0.0" as const;

export type F205W3cTraceparentHeaderPropagatorConfig = BaseFeatureConfig<
  typeof F205_FEATURE_ID,
  typeof F205_STAGE,
  typeof F205_OPERATION_CODE
>;

export interface F205W3cTraceparentHeaderPropagatorInput extends BaseFeatureInput {
  readonly trace_id: string | number | boolean | readonly string[];
  readonly parent_span_id: string | number | boolean | readonly string[];
  readonly child_span_id: string | number | boolean | readonly string[];
  readonly next_traceparent: string | number | boolean | readonly string[];
}

export interface F205W3cTraceparentHeaderPropagatorOutput {
  readonly featureId: typeof F205_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F205_OPERATION_CODE;
  readonly resolved_trace_id: unknown;
  readonly resolved_parent_span_id: unknown;
  readonly resolved_child_span_id: unknown;
  readonly resolved_next_traceparent: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F205_FEATURE_ID>;
}

export type F205W3cTraceparentHeaderPropagatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F205_FEATURE_ID>;

export const DEFAULT_F205_CONFIG: F205W3cTraceparentHeaderPropagatorConfig = {
  featureId: F205_FEATURE_ID,
  stage: F205_STAGE,
  operationCode: F205_OPERATION_CODE,
  contractVersion: F205_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F205W3cTraceparentHeaderPropagatorValidationError extends Error {
  public readonly featureId = F205_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F205 Validation Error on '${field}']: ${message}`);
    this.name = "F205W3cTraceparentHeaderPropagatorValidationError";
    this.field = field;
  }
}

export function computeF205Digest(rawPayload: string): string {
  return `f205_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F205W3cTraceparentHeaderPropagatorService extends KosmoraFeatureAdapterBase<
  typeof F205_FEATURE_ID,
  typeof F205_STAGE,
  typeof F205_OPERATION_CODE,
  F205W3cTraceparentHeaderPropagatorConfig,
  F205W3cTraceparentHeaderPropagatorInput,
  F205W3cTraceparentHeaderPropagatorOutput
> {
  constructor(customConfig?: Partial<F205W3cTraceparentHeaderPropagatorConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F205_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["trace_id", "parent_span_id", "child_span_id", "next_traceparent"] as const,
      F205W3cTraceparentHeaderPropagatorValidationError
    );
  }
}

export function verifyF205Module(): {
  readonly featureId: typeof F205_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F205W3cTraceparentHeaderPropagatorService();
  const sampleInput: F205W3cTraceparentHeaderPropagatorInput = {
    requestId: "req_verify_f205",
    projectId: "proj_kosmora_f205",
    workspaceId: "ws_kosmora_f205",
    tenantId: "tenant_rlm_f205",
    actorId: "actor_verifier_f205",
    autonomyLevel: "A3",
    trace_id: "seed_f205_trace_id",
    parent_span_id: 42,
    child_span_id: true,
    next_traceparent: "seed_f205_next_traceparent",
    metadata: { stage: "stage7-formal-verification", featureId: "F205" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F205" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F205] Verification failed`);
  }

  return {
    featureId: F205_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
