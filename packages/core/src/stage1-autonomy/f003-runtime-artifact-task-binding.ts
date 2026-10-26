/**
 * F003 (stage1-autonomy): Связывание рантайм-артефактов с графом задач
 * Жёсткая привязка каждого сгенерированного файла или блока кода к конкретному узлу задачи
 * Operation Code: artifact_binding
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

export const F003_FEATURE_ID = "F003" as const;
export const F003_STAGE = "stage1-autonomy" as const;
export const F003_OPERATION_CODE = "artifact_binding" as const;
export const F003_CONTRACT_VERSION = "2.0.0" as const;

export type F003RuntimeArtifactTaskBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F003RuntimeArtifactTaskBindingConfig = BaseFeatureConfig<
  typeof F003_FEATURE_ID,
  typeof F003_STAGE,
  typeof F003_OPERATION_CODE
>;

export interface F003RuntimeArtifactTaskBindingInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly task_id: string | number;
  readonly graph_id: string | number | boolean | readonly string[];
  readonly producer_role: string | number | boolean | Record<string, unknown>;
}

export type F003RuntimeArtifactTaskBindingAuditEntry = BaseFeatureAuditEntry<typeof F003_FEATURE_ID>;

export interface F003RuntimeArtifactTaskBindingOutput {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F003RuntimeArtifactTaskBindingExecutionStatus;
  readonly operationCode: typeof F003_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_task_id: string | number;
  readonly resolved_graph_id: string | number | boolean | readonly string[];
  readonly resolved_producer_role: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F003RuntimeArtifactTaskBindingAuditEntry;
}

export type F003RuntimeArtifactTaskBindingTelemetrySnapshot = BaseFeatureTelemetry<typeof F003_FEATURE_ID>;

export const DEFAULT_F003_CONFIG: F003RuntimeArtifactTaskBindingConfig = {
  featureId: F003_FEATURE_ID,
  stage: F003_STAGE,
  operationCode: F003_OPERATION_CODE,
  contractVersion: F003_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F003RuntimeArtifactTaskBindingValidationError extends Error {
  public readonly featureId = F003_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F003 Validation Error on '${field}']: ${message}`);
    this.name = "F003RuntimeArtifactTaskBindingValidationError";
    this.field = field;
  }
}

export function computeF003Digest(rawPayload: string): string {
  return `f003_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F003RuntimeArtifactTaskBindingEngine extends KosmoraFeatureAdapterBase<
  typeof F003_FEATURE_ID,
  typeof F003_STAGE,
  typeof F003_OPERATION_CODE,
  F003RuntimeArtifactTaskBindingConfig,
  F003RuntimeArtifactTaskBindingInput,
  F003RuntimeArtifactTaskBindingOutput
> {
  constructor(customConfig?: Partial<F003RuntimeArtifactTaskBindingConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F003_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["artifact_id", "task_id", "graph_id", "producer_role"] as const,
      F003RuntimeArtifactTaskBindingValidationError
    );
  }
}

export function verifyF003Module(): {
  featureId: typeof F003_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F003RuntimeArtifactTaskBindingEngine();
  const sampleInput: F003RuntimeArtifactTaskBindingInput = {
    requestId: "req_verify_f003",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f003_artifact_id_seed",
    task_id: 42,
    graph_id: true,
    producer_role: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 3 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F003" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F003_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
