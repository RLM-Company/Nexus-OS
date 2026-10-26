/**
 * F036 (stage2-canvas): Визуальный Diff версий артефакта
 * Построчное сравнение изменений между редакциями отчёта или кода (зелёный/красный подсвет)
 * Operation Code: visual_diff_engine
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

export const F036_FEATURE_ID = "F036" as const;
export const F036_STAGE = "stage2-canvas" as const;
export const F036_OPERATION_CODE = "visual_diff_engine" as const;
export const F036_CONTRACT_VERSION = "2.0.0" as const;

export type F036VisualArtifactVersionDiffExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F036VisualArtifactVersionDiffConfig = BaseFeatureConfig<
  typeof F036_FEATURE_ID,
  typeof F036_STAGE,
  typeof F036_OPERATION_CODE
>;

export interface F036VisualArtifactVersionDiffInput extends BaseFeatureInput {
  readonly from_version: string;
  readonly to_version: string | number;
  readonly added_lines_count: string | number | boolean | readonly string[];
  readonly removed_lines_count: string | number | boolean | Record<string, unknown>;
}

export type F036VisualArtifactVersionDiffAuditEntry = BaseFeatureAuditEntry<typeof F036_FEATURE_ID>;

export interface F036VisualArtifactVersionDiffOutput {
  readonly featureId: typeof F036_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F036VisualArtifactVersionDiffExecutionStatus;
  readonly operationCode: typeof F036_OPERATION_CODE;
  readonly resolved_from_version: string;
  readonly resolved_to_version: string | number;
  readonly resolved_added_lines_count: string | number | boolean | readonly string[];
  readonly resolved_removed_lines_count: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F036VisualArtifactVersionDiffAuditEntry;
}

export type F036VisualArtifactVersionDiffTelemetrySnapshot = BaseFeatureTelemetry<typeof F036_FEATURE_ID>;

export const DEFAULT_F036_CONFIG: F036VisualArtifactVersionDiffConfig = {
  featureId: F036_FEATURE_ID,
  stage: F036_STAGE,
  operationCode: F036_OPERATION_CODE,
  contractVersion: F036_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F036VisualArtifactVersionDiffValidationError extends Error {
  public readonly featureId = F036_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F036 Validation Error on '${field}']: ${message}`);
    this.name = "F036VisualArtifactVersionDiffValidationError";
    this.field = field;
  }
}

export function computeF036Digest(rawPayload: string): string {
  return `f036_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F036VisualArtifactVersionDiffEngine extends KosmoraFeatureAdapterBase<
  typeof F036_FEATURE_ID,
  typeof F036_STAGE,
  typeof F036_OPERATION_CODE,
  F036VisualArtifactVersionDiffConfig,
  F036VisualArtifactVersionDiffInput,
  F036VisualArtifactVersionDiffOutput
> {
  constructor(customConfig?: Partial<F036VisualArtifactVersionDiffConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F036_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["from_version", "to_version", "added_lines_count", "removed_lines_count"] as const,
      F036VisualArtifactVersionDiffValidationError
    );
  }
}

export function verifyF036Module(): {
  featureId: typeof F036_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F036VisualArtifactVersionDiffEngine();
  const sampleInput: F036VisualArtifactVersionDiffInput = {
    requestId: "req_verify_f036",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    from_version: "f036_from_version_seed",
    to_version: 42,
    added_lines_count: true,
    removed_lines_count: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 36 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F036" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_from_version !== sampleInput.from_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F036_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
