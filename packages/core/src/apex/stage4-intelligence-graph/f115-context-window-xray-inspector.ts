/**
 * F115 (stage4-intelligence-graph): Инспектор контекстного окна (Context Window X-Ray)
 * Наглядная шкала того, сколько токенов занимают системный промпт, граф, файлы и история чата
 * Operation Code: context_xray_telemetry
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F115_FEATURE_ID = "F115" as const;
export const F115_STAGE = "stage4-intelligence-graph" as const;
export const F115_OPERATION_CODE = "context_xray_telemetry" as const;
export const F115_CONTRACT_VERSION = "2.0.0" as const;

export type F115ContextWindowXrayInspectorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F115ContextWindowXrayInspectorConfig = BaseFeatureConfig<
  typeof F115_FEATURE_ID,
  typeof F115_STAGE,
  typeof F115_OPERATION_CODE
>;

export interface F115ContextWindowXrayInspectorInput extends BaseFeatureInput {
  readonly max_tokens: string;
  readonly used_tokens: string | number;
  readonly utilization_pct: string | number | boolean | readonly string[];
  readonly segment_breakdown: string | number | boolean | Record<string, unknown>;
}

export type F115ContextWindowXrayInspectorAuditEntry = BaseFeatureAuditEntry<
  typeof F115_FEATURE_ID
>;

export interface F115ContextWindowXrayInspectorOutput {
  readonly featureId: typeof F115_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F115ContextWindowXrayInspectorExecutionStatus;
  readonly operationCode: typeof F115_OPERATION_CODE;
  readonly resolved_max_tokens: string;
  readonly resolved_used_tokens: string | number;
  readonly resolved_utilization_pct: string | number | boolean | readonly string[];
  readonly resolved_segment_breakdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F115ContextWindowXrayInspectorAuditEntry;
}

export type F115ContextWindowXrayInspectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F115_FEATURE_ID
>;

export const DEFAULT_F115_CONFIG: F115ContextWindowXrayInspectorConfig = {
  featureId: F115_FEATURE_ID,
  stage: F115_STAGE,
  operationCode: F115_OPERATION_CODE,
  contractVersion: F115_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F115ContextWindowXrayInspectorValidationError extends Error {
  public readonly featureId = F115_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F115 Validation Error on '${field}']: ${message}`);
    this.name = "F115ContextWindowXrayInspectorValidationError";
    this.field = field;
  }
}

export function computeF115Digest(rawPayload: string): string {
  return `f115_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F115ContextWindowXrayInspectorEngine extends KosmoraFeatureAdapterBase<
  typeof F115_FEATURE_ID,
  typeof F115_STAGE,
  typeof F115_OPERATION_CODE,
  F115ContextWindowXrayInspectorConfig,
  F115ContextWindowXrayInspectorInput,
  F115ContextWindowXrayInspectorOutput
> {
  constructor(
    customConfig?: Partial<F115ContextWindowXrayInspectorConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F115_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["max_tokens", "used_tokens", "utilization_pct", "segment_breakdown"] as const,
      F115ContextWindowXrayInspectorValidationError
    );
  }
}

export function verifyF115Module(): {
  featureId: typeof F115_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F115ContextWindowXrayInspectorEngine();
  const sampleInput: F115ContextWindowXrayInspectorInput = {
    requestId: "req_verify_f115",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    max_tokens: "f115_max_tokens_seed",
    used_tokens: 42,
    utilization_pct: true,
    segment_breakdown: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 115 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F115" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_max_tokens !== sampleInput.max_tokens &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F115_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
