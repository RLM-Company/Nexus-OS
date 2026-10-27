/**
 * F206 (stage7-formal-verification): Сборщик распределённого дерева спанов (Span DAG) мультиагентного прогона
 * Реконструкция полной причинно-следственной иерархии вызовов микросервисов и скиллов по traceId
 * Operation Code: distributed_span_dag_assembler
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

export const F206_FEATURE_ID = "F206" as const;
export const F206_STAGE = "stage7-formal-verification" as const;
export const F206_OPERATION_CODE = "distributed_span_dag_assembler" as const;
export const F206_CONTRACT_VERSION = "2.0.0" as const;

export type F206DistributedSpanDagAssemblerConfig = BaseFeatureConfig<
  typeof F206_FEATURE_ID,
  typeof F206_STAGE,
  typeof F206_OPERATION_CODE
>;

export interface F206DistributedSpanDagAssemblerInput extends BaseFeatureInput {
  readonly trace_id: string | number | boolean | readonly string[];
  readonly span_count: string | number | boolean | readonly string[];
  readonly root_span_id: string | number | boolean | readonly string[];
  readonly trace_digest: string | number | boolean | readonly string[];
}

export interface F206DistributedSpanDagAssemblerOutput {
  readonly featureId: typeof F206_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F206_OPERATION_CODE;
  readonly resolved_trace_id: unknown;
  readonly resolved_span_count: unknown;
  readonly resolved_root_span_id: unknown;
  readonly resolved_trace_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F206_FEATURE_ID>;
}

export type F206DistributedSpanDagAssemblerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F206_FEATURE_ID
>;

export const DEFAULT_F206_CONFIG: F206DistributedSpanDagAssemblerConfig = {
  featureId: F206_FEATURE_ID,
  stage: F206_STAGE,
  operationCode: F206_OPERATION_CODE,
  contractVersion: F206_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F206DistributedSpanDagAssemblerValidationError extends Error {
  public readonly featureId = F206_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F206 Validation Error on '${field}']: ${message}`);
    this.name = "F206DistributedSpanDagAssemblerValidationError";
    this.field = field;
  }
}

export function computeF206Digest(rawPayload: string): string {
  return `f206_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F206DistributedSpanDagAssemblerService extends KosmoraFeatureAdapterBase<
  typeof F206_FEATURE_ID,
  typeof F206_STAGE,
  typeof F206_OPERATION_CODE,
  F206DistributedSpanDagAssemblerConfig,
  F206DistributedSpanDagAssemblerInput,
  F206DistributedSpanDagAssemblerOutput
> {
  constructor(
    customConfig?: Partial<F206DistributedSpanDagAssemblerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F206_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["trace_id", "span_count", "root_span_id", "trace_digest"] as const,
      F206DistributedSpanDagAssemblerValidationError
    );
  }
}

export function verifyF206Module(): {
  readonly featureId: typeof F206_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F206DistributedSpanDagAssemblerService();
  const sampleInput: F206DistributedSpanDagAssemblerInput = {
    requestId: "req_verify_f206",
    projectId: "proj_kosmora_f206",
    workspaceId: "ws_kosmora_f206",
    tenantId: "tenant_rlm_f206",
    actorId: "actor_verifier_f206",
    autonomyLevel: "A3",
    trace_id: "seed_f206_trace_id",
    span_count: 42,
    root_span_id: true,
    trace_digest: "seed_f206_trace_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F206" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F206" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F206] Verification failed`);
  }

  return {
    featureId: F206_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
