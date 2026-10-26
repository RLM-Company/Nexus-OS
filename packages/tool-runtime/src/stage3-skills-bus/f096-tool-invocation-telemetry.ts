/**
 * F096 (stage3-skills-bus): Телеметрия успешности вызовов инструментов
 * Статистика отказов и времени отклика по каждому внешнему коннектору
 * Operation Code: tool_metrics_collector
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F096_FEATURE_ID = "F096" as const;
export const F096_STAGE = "stage3-skills-bus" as const;
export const F096_OPERATION_CODE = "tool_metrics_collector" as const;
export const F096_CONTRACT_VERSION = "2.0.0" as const;

export type F096ToolInvocationTelemetryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F096ToolInvocationTelemetryConfig = BaseFeatureConfig<
  typeof F096_FEATURE_ID,
  typeof F096_STAGE,
  typeof F096_OPERATION_CODE
>;

export interface F096ToolInvocationTelemetryInput extends BaseFeatureInput {
  readonly connector_id: string;
  readonly success_rate_pct: string | number;
  readonly avg_latency_ms: string | number | boolean | readonly string[];
  readonly total_invocations: string | number | boolean | Record<string, unknown>;
}

export type F096ToolInvocationTelemetryAuditEntry = BaseFeatureAuditEntry<typeof F096_FEATURE_ID>;

export interface F096ToolInvocationTelemetryOutput {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F096ToolInvocationTelemetryExecutionStatus;
  readonly operationCode: typeof F096_OPERATION_CODE;
  readonly resolved_connector_id: string;
  readonly resolved_success_rate_pct: string | number;
  readonly resolved_avg_latency_ms: string | number | boolean | readonly string[];
  readonly resolved_total_invocations: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F096ToolInvocationTelemetryAuditEntry;
}

export type F096ToolInvocationTelemetryTelemetrySnapshot = BaseFeatureTelemetry<typeof F096_FEATURE_ID>;

export const DEFAULT_F096_CONFIG: F096ToolInvocationTelemetryConfig = {
  featureId: F096_FEATURE_ID,
  stage: F096_STAGE,
  operationCode: F096_OPERATION_CODE,
  contractVersion: F096_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F096ToolInvocationTelemetryValidationError extends Error {
  public readonly featureId = F096_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F096 Validation Error on '${field}']: ${message}`);
    this.name = "F096ToolInvocationTelemetryValidationError";
    this.field = field;
  }
}

export function computeF096Digest(rawPayload: string): string {
  return `f096_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F096ToolInvocationTelemetryEngine extends KosmoraFeatureAdapterBase<
  typeof F096_FEATURE_ID,
  typeof F096_STAGE,
  typeof F096_OPERATION_CODE,
  F096ToolInvocationTelemetryConfig,
  F096ToolInvocationTelemetryInput,
  F096ToolInvocationTelemetryOutput
> {
  constructor(customConfig?: Partial<F096ToolInvocationTelemetryConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F096_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["connector_id", "success_rate_pct", "avg_latency_ms", "total_invocations"] as const,
      F096ToolInvocationTelemetryValidationError
    );
  }
  protected override validateDomainInvariants(input: F096ToolInvocationTelemetryInput): void {
    if (typeof input.success_rate_pct === "number" && input.success_rate_pct > 1000) {
      throw new F096ToolInvocationTelemetryValidationError("success_rate_pct", "Metric 'success_rate_pct' exceeds maximum normalized ceiling (1000).");
    }
  }
}

export function verifyF096Module(): {
  featureId: typeof F096_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F096ToolInvocationTelemetryEngine();
  const sampleInput: F096ToolInvocationTelemetryInput = {
    requestId: "req_verify_f096",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    connector_id: "f096_connector_id_seed",
    success_rate_pct: 42,
    avg_latency_ms: true,
    total_invocations: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 96 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F096" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_connector_id !== sampleInput.connector_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F096_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
