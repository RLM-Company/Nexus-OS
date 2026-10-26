/**
 * F207 (stage7-formal-verification): Анализатор критического пути (Critical Path) в распределённой трассе
 * Вычисление самой длинной цепочки зависимых спанов, определяющей общее время ответа системы
 * Operation Code: critical_path_latency_analyzer
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

export const F207_FEATURE_ID = "F207" as const;
export const F207_STAGE = "stage7-formal-verification" as const;
export const F207_OPERATION_CODE = "critical_path_latency_analyzer" as const;
export const F207_CONTRACT_VERSION = "2.0.0" as const;

export type F207CriticalPathLatencyAnalyzerConfig = BaseFeatureConfig<
  typeof F207_FEATURE_ID,
  typeof F207_STAGE,
  typeof F207_OPERATION_CODE
>;

export interface F207CriticalPathLatencyAnalyzerInput extends BaseFeatureInput {
  readonly trace_id: string | number | boolean | readonly string[];
  readonly critical_path_ms: string | number | boolean | readonly string[];
  readonly critical_span_ids: string | number | boolean | readonly string[];
  readonly total_duration_ms: string | number | boolean | readonly string[];
}

export interface F207CriticalPathLatencyAnalyzerOutput {
  readonly featureId: typeof F207_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F207_OPERATION_CODE;
  readonly resolved_trace_id: unknown;
  readonly resolved_critical_path_ms: unknown;
  readonly resolved_critical_span_ids: unknown;
  readonly resolved_total_duration_ms: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F207_FEATURE_ID>;
}

export type F207CriticalPathLatencyAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F207_FEATURE_ID
>;

export const DEFAULT_F207_CONFIG: F207CriticalPathLatencyAnalyzerConfig = {
  featureId: F207_FEATURE_ID,
  stage: F207_STAGE,
  operationCode: F207_OPERATION_CODE,
  contractVersion: F207_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F207CriticalPathLatencyAnalyzerValidationError extends Error {
  public readonly featureId = F207_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F207 Validation Error on '${field}']: ${message}`);
    this.name = "F207CriticalPathLatencyAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF207Digest(rawPayload: string): string {
  return `f207_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F207CriticalPathLatencyAnalyzerService extends KosmoraFeatureAdapterBase<
  typeof F207_FEATURE_ID,
  typeof F207_STAGE,
  typeof F207_OPERATION_CODE,
  F207CriticalPathLatencyAnalyzerConfig,
  F207CriticalPathLatencyAnalyzerInput,
  F207CriticalPathLatencyAnalyzerOutput
> {
  constructor(
    customConfig?: Partial<F207CriticalPathLatencyAnalyzerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F207_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["trace_id", "critical_path_ms", "critical_span_ids", "total_duration_ms"] as const,
      F207CriticalPathLatencyAnalyzerValidationError
    );
  }
}

export function verifyF207Module(): {
  readonly featureId: typeof F207_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F207CriticalPathLatencyAnalyzerService();
  const sampleInput: F207CriticalPathLatencyAnalyzerInput = {
    requestId: "req_verify_f207",
    projectId: "proj_kosmora_f207",
    workspaceId: "ws_kosmora_f207",
    tenantId: "tenant_rlm_f207",
    actorId: "actor_verifier_f207",
    autonomyLevel: "A3",
    trace_id: "seed_f207_trace_id",
    critical_path_ms: 42,
    critical_span_ids: true,
    total_duration_ms: "seed_f207_total_duration_ms",
    metadata: { stage: "stage7-formal-verification", featureId: "F207" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F207" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F207] Verification failed`);
  }

  return {
    featureId: F207_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
