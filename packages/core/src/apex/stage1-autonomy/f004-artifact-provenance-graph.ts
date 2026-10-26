/**
 * F004 (stage1-autonomy): Граф происхождения артефактов (Artifact Provenance Graph)
 * Отслеживание полной цепочки: кто создал, на основе каких данных и каким промптом
 * Operation Code: provenance_lineage
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

export const F004_FEATURE_ID = "F004" as const;
export const F004_STAGE = "stage1-autonomy" as const;
export const F004_OPERATION_CODE = "provenance_lineage" as const;
export const F004_CONTRACT_VERSION = "2.0.0" as const;

export type F004ArtifactProvenanceGraphExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F004ArtifactProvenanceGraphConfig = BaseFeatureConfig<
  typeof F004_FEATURE_ID,
  typeof F004_STAGE,
  typeof F004_OPERATION_CODE
>;

export interface F004ArtifactProvenanceGraphInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly prompt_hash: string | number;
  readonly source_artifact_ids: string | number | boolean | readonly string[];
  readonly model_route_id: string | number | boolean | Record<string, unknown>;
}

export type F004ArtifactProvenanceGraphAuditEntry = BaseFeatureAuditEntry<typeof F004_FEATURE_ID>;

export interface F004ArtifactProvenanceGraphOutput {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F004ArtifactProvenanceGraphExecutionStatus;
  readonly operationCode: typeof F004_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_prompt_hash: string | number;
  readonly resolved_source_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_model_route_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F004ArtifactProvenanceGraphAuditEntry;
}

export type F004ArtifactProvenanceGraphTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F004_FEATURE_ID
>;

export const DEFAULT_F004_CONFIG: F004ArtifactProvenanceGraphConfig = {
  featureId: F004_FEATURE_ID,
  stage: F004_STAGE,
  operationCode: F004_OPERATION_CODE,
  contractVersion: F004_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F004ArtifactProvenanceGraphValidationError extends Error {
  public readonly featureId = F004_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F004 Validation Error on '${field}']: ${message}`);
    this.name = "F004ArtifactProvenanceGraphValidationError";
    this.field = field;
  }
}

export function computeF004Digest(rawPayload: string): string {
  return `f004_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F004ArtifactProvenanceGraphEngine extends KosmoraFeatureAdapterBase<
  typeof F004_FEATURE_ID,
  typeof F004_STAGE,
  typeof F004_OPERATION_CODE,
  F004ArtifactProvenanceGraphConfig,
  F004ArtifactProvenanceGraphInput,
  F004ArtifactProvenanceGraphOutput
> {
  constructor(
    customConfig?: Partial<F004ArtifactProvenanceGraphConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F004_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["artifact_id", "prompt_hash", "source_artifact_ids", "model_route_id"] as const,
      F004ArtifactProvenanceGraphValidationError
    );
  }
}

export function verifyF004Module(): {
  featureId: typeof F004_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F004ArtifactProvenanceGraphEngine();
  const sampleInput: F004ArtifactProvenanceGraphInput = {
    requestId: "req_verify_f004",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f004_artifact_id_seed",
    prompt_hash: 42,
    source_artifact_ids: true,
    model_route_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 4 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F004" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F004_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
