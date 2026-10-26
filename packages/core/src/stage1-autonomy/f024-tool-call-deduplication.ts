/**
 * F024 (stage1-autonomy): Дедупликация вызовов инструментов
 * Кэширование идентичных запросов агентов в рамках одной сессии
 * Operation Code: tool_dedup_cache
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F024_FEATURE_ID = "F024" as const;
export const F024_STAGE = "stage1-autonomy" as const;
export const F024_OPERATION_CODE = "tool_dedup_cache" as const;
export const F024_CONTRACT_VERSION = "2.0.0" as const;

export type F024ToolCallDeduplicationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F024ToolCallDeduplicationConfig = BaseFeatureConfig<
  typeof F024_FEATURE_ID,
  typeof F024_STAGE,
  typeof F024_OPERATION_CODE
>;

export interface F024ToolCallDeduplicationInput extends BaseFeatureInput {
  readonly session_id: string;
  readonly call_fingerprint: string | number;
  readonly cache_hit: string | number | boolean | readonly string[];
  readonly saved_execution_ms: string | number | boolean | Record<string, unknown>;
}

export type F024ToolCallDeduplicationAuditEntry = BaseFeatureAuditEntry<typeof F024_FEATURE_ID>;

export interface F024ToolCallDeduplicationOutput {
  readonly featureId: typeof F024_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F024ToolCallDeduplicationExecutionStatus;
  readonly operationCode: typeof F024_OPERATION_CODE;
  readonly resolved_session_id: string;
  readonly resolved_call_fingerprint: string | number;
  readonly resolved_cache_hit: string | number | boolean | readonly string[];
  readonly resolved_saved_execution_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F024ToolCallDeduplicationAuditEntry;
}

export type F024ToolCallDeduplicationTelemetrySnapshot = BaseFeatureTelemetry<typeof F024_FEATURE_ID>;

export const DEFAULT_F024_CONFIG: F024ToolCallDeduplicationConfig = {
  featureId: F024_FEATURE_ID,
  stage: F024_STAGE,
  operationCode: F024_OPERATION_CODE,
  contractVersion: F024_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F024ToolCallDeduplicationValidationError extends Error {
  public readonly featureId = F024_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F024 Validation Error on '${field}']: ${message}`);
    this.name = "F024ToolCallDeduplicationValidationError";
    this.field = field;
  }
}

export function computeF024Digest(rawPayload: string): string {
  return `f024_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F024ToolCallDeduplicationEngine extends KosmoraFeatureAdapterBase<
  typeof F024_FEATURE_ID,
  typeof F024_STAGE,
  typeof F024_OPERATION_CODE,
  F024ToolCallDeduplicationConfig,
  F024ToolCallDeduplicationInput,
  F024ToolCallDeduplicationOutput
> {
  constructor(customConfig?: Partial<F024ToolCallDeduplicationConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F024_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["session_id", "call_fingerprint", "cache_hit", "saved_execution_ms"] as const,
      F024ToolCallDeduplicationValidationError
    );
  }
}

export function verifyF024Module(): {
  featureId: typeof F024_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F024ToolCallDeduplicationEngine();
  const sampleInput: F024ToolCallDeduplicationInput = {
    requestId: "req_verify_f024",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    session_id: "f024_session_id_seed",
    call_fingerprint: 42,
    cache_hit: true,
    saved_execution_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 24 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F024" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_session_id !== sampleInput.session_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F024_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
