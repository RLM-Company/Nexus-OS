/**
 * F049 (stage2-canvas): Инспектор цепочки происхождения (Provenance Inspector UI)
 * Боковая панель, показывающая, из каких чанков документов и задач родился текущий артефакт
 * Operation Code: provenance_drawer
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F049_FEATURE_ID = "F049" as const;
export const F049_STAGE = "stage2-canvas" as const;
export const F049_OPERATION_CODE = "provenance_drawer" as const;
export const F049_CONTRACT_VERSION = "2.0.0" as const;

export type F049ProvenanceInspectorUiExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F049ProvenanceInspectorUiConfig = BaseFeatureConfig<
  typeof F049_FEATURE_ID,
  typeof F049_STAGE,
  typeof F049_OPERATION_CODE
>;

export interface F049ProvenanceInspectorUiInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly upstream_tasks: string | number;
  readonly source_chunks: string | number | boolean | readonly string[];
  readonly lineage_depth: string | number | boolean | Record<string, unknown>;
}

export type F049ProvenanceInspectorUiAuditEntry = BaseFeatureAuditEntry<typeof F049_FEATURE_ID>;

export interface F049ProvenanceInspectorUiOutput {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F049ProvenanceInspectorUiExecutionStatus;
  readonly operationCode: typeof F049_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_upstream_tasks: string | number;
  readonly resolved_source_chunks: string | number | boolean | readonly string[];
  readonly resolved_lineage_depth: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F049ProvenanceInspectorUiAuditEntry;
}

export type F049ProvenanceInspectorUiTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F049_FEATURE_ID
>;

export const DEFAULT_F049_CONFIG: F049ProvenanceInspectorUiConfig = {
  featureId: F049_FEATURE_ID,
  stage: F049_STAGE,
  operationCode: F049_OPERATION_CODE,
  contractVersion: F049_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F049ProvenanceInspectorUiValidationError extends Error {
  public readonly featureId = F049_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F049 Validation Error on '${field}']: ${message}`);
    this.name = "F049ProvenanceInspectorUiValidationError";
    this.field = field;
  }
}

export function computeF049Digest(rawPayload: string): string {
  return `f049_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F049ProvenanceInspectorUiEngine extends KosmoraFeatureAdapterBase<
  typeof F049_FEATURE_ID,
  typeof F049_STAGE,
  typeof F049_OPERATION_CODE,
  F049ProvenanceInspectorUiConfig,
  F049ProvenanceInspectorUiInput,
  F049ProvenanceInspectorUiOutput
> {
  constructor(
    customConfig?: Partial<F049ProvenanceInspectorUiConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F049_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "upstream_tasks", "source_chunks", "lineage_depth"] as const,
      F049ProvenanceInspectorUiValidationError
    );
  }
}

export function verifyF049Module(): {
  featureId: typeof F049_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F049ProvenanceInspectorUiEngine();
  const sampleInput: F049ProvenanceInspectorUiInput = {
    requestId: "req_verify_f049",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f049_artifact_id_seed",
    upstream_tasks: 42,
    source_chunks: true,
    lineage_depth: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 49 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F049" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F049_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
