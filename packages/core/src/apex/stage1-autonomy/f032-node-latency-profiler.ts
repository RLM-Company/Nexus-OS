/**
 * F032 (stage1-autonomy): Трассировка латентности узлов (Node Latency Profiler)
 * Замер времени выполнения каждого шага графа для поиска узких мест
 * Operation Code: latency_profiler
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

export const F032_FEATURE_ID = "F032" as const;
export const F032_STAGE = "stage1-autonomy" as const;
export const F032_OPERATION_CODE = "latency_profiler" as const;
export const F032_CONTRACT_VERSION = "2.0.0" as const;

export type F032NodeLatencyProfilerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F032NodeLatencyProfilerConfig = BaseFeatureConfig<
  typeof F032_FEATURE_ID,
  typeof F032_STAGE,
  typeof F032_OPERATION_CODE
>;

export interface F032NodeLatencyProfilerInput extends BaseFeatureInput {
  readonly graph_id: string;
  readonly bottleneck_node_id: string | number;
  readonly p95_latency_ms: string | number | boolean | readonly string[];
  readonly total_graph_ms: string | number | boolean | Record<string, unknown>;
}

export type F032NodeLatencyProfilerAuditEntry = BaseFeatureAuditEntry<typeof F032_FEATURE_ID>;

export interface F032NodeLatencyProfilerOutput {
  readonly featureId: typeof F032_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F032NodeLatencyProfilerExecutionStatus;
  readonly operationCode: typeof F032_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_bottleneck_node_id: string | number;
  readonly resolved_p95_latency_ms: string | number | boolean | readonly string[];
  readonly resolved_total_graph_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F032NodeLatencyProfilerAuditEntry;
}

export type F032NodeLatencyProfilerTelemetrySnapshot = BaseFeatureTelemetry<typeof F032_FEATURE_ID>;

export const DEFAULT_F032_CONFIG: F032NodeLatencyProfilerConfig = {
  featureId: F032_FEATURE_ID,
  stage: F032_STAGE,
  operationCode: F032_OPERATION_CODE,
  contractVersion: F032_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F032NodeLatencyProfilerValidationError extends Error {
  public readonly featureId = F032_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F032 Validation Error on '${field}']: ${message}`);
    this.name = "F032NodeLatencyProfilerValidationError";
    this.field = field;
  }
}

export function computeF032Digest(rawPayload: string): string {
  return `f032_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F032NodeLatencyProfilerEngine extends KosmoraFeatureAdapterBase<
  typeof F032_FEATURE_ID,
  typeof F032_STAGE,
  typeof F032_OPERATION_CODE,
  F032NodeLatencyProfilerConfig,
  F032NodeLatencyProfilerInput,
  F032NodeLatencyProfilerOutput
> {
  constructor(
    customConfig?: Partial<F032NodeLatencyProfilerConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F032_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["graph_id", "bottleneck_node_id", "p95_latency_ms", "total_graph_ms"] as const,
      F032NodeLatencyProfilerValidationError
    );
  }
}

export function verifyF032Module(): {
  featureId: typeof F032_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F032NodeLatencyProfilerEngine();
  const sampleInput: F032NodeLatencyProfilerInput = {
    requestId: "req_verify_f032",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f032_graph_id_seed",
    bottleneck_node_id: 42,
    p95_latency_ms: true,
    total_graph_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 32 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F032" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F032_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
