/**
 * F141 (stage5-enterprise): Сквозная трассировка мультиагентных прогонов (OpenTelemetry Tracing)
 * Визуализация полного пути запроса через все микросервисы и воркеры
 * Operation Code: otel_span_exporter
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F141_FEATURE_ID = "F141" as const;
export const F141_STAGE = "stage5-enterprise" as const;
export const F141_OPERATION_CODE = "otel_span_exporter" as const;
export const F141_CONTRACT_VERSION = "2.0.0" as const;

export type F141OpentelemetryMultiagentTracingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F141OpentelemetryMultiagentTracingConfig = BaseFeatureConfig<
  typeof F141_FEATURE_ID,
  typeof F141_STAGE,
  typeof F141_OPERATION_CODE
>;

export interface F141OpentelemetryMultiagentTracingInput extends BaseFeatureInput {
  readonly trace_id: string;
  readonly span_id: string | number;
  readonly parent_span_id: string | number | boolean | readonly string[];
  readonly service_hop_timings: string | number | boolean | Record<string, unknown>;
}

export type F141OpentelemetryMultiagentTracingAuditEntry = BaseFeatureAuditEntry<typeof F141_FEATURE_ID>;

export interface F141OpentelemetryMultiagentTracingOutput {
  readonly featureId: typeof F141_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F141OpentelemetryMultiagentTracingExecutionStatus;
  readonly operationCode: typeof F141_OPERATION_CODE;
  readonly resolved_trace_id: string;
  readonly resolved_span_id: string | number;
  readonly resolved_parent_span_id: string | number | boolean | readonly string[];
  readonly resolved_service_hop_timings: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F141OpentelemetryMultiagentTracingAuditEntry;
}

export type F141OpentelemetryMultiagentTracingTelemetrySnapshot = BaseFeatureTelemetry<typeof F141_FEATURE_ID>;

export const DEFAULT_F141_CONFIG: F141OpentelemetryMultiagentTracingConfig = {
  featureId: F141_FEATURE_ID,
  stage: F141_STAGE,
  operationCode: F141_OPERATION_CODE,
  contractVersion: F141_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F141OpentelemetryMultiagentTracingValidationError extends Error {
  public readonly featureId = F141_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F141 Validation Error on '${field}']: ${message}`);
    this.name = "F141OpentelemetryMultiagentTracingValidationError";
    this.field = field;
  }
}

export function computeF141Digest(rawPayload: string): string {
  return `f141_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F141OpentelemetryMultiagentTracingEngine extends KosmoraFeatureAdapterBase<
  typeof F141_FEATURE_ID,
  typeof F141_STAGE,
  typeof F141_OPERATION_CODE,
  F141OpentelemetryMultiagentTracingConfig,
  F141OpentelemetryMultiagentTracingInput,
  F141OpentelemetryMultiagentTracingOutput
> {
  constructor(customConfig?: Partial<F141OpentelemetryMultiagentTracingConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F141_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["trace_id", "span_id", "parent_span_id", "service_hop_timings"] as const,
      F141OpentelemetryMultiagentTracingValidationError
    );
  }
}

export function verifyF141Module(): {
  featureId: typeof F141_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F141OpentelemetryMultiagentTracingEngine();
  const sampleInput: F141OpentelemetryMultiagentTracingInput = {
    requestId: "req_verify_f141",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    trace_id: "f141_trace_id_seed",
    span_id: 42,
    parent_span_id: true,
    service_hop_timings: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 141 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F141" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F141_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
