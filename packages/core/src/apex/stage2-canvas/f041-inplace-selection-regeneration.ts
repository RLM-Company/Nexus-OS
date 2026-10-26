/**
 * F041 (stage2-canvas): Частичная регенерация блока (In-place Selection Edit)
 * Переписывание агентом только выделенного абзаца или функции без пересборки всего файла
 * Operation Code: partial_block_edit
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

export const F041_FEATURE_ID = "F041" as const;
export const F041_STAGE = "stage2-canvas" as const;
export const F041_OPERATION_CODE = "partial_block_edit" as const;
export const F041_CONTRACT_VERSION = "2.0.0" as const;

export type F041InplaceSelectionRegenerationExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F041InplaceSelectionRegenerationConfig = BaseFeatureConfig<
  typeof F041_FEATURE_ID,
  typeof F041_STAGE,
  typeof F041_OPERATION_CODE
>;

export interface F041InplaceSelectionRegenerationInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly start_line: string | number;
  readonly end_line: string | number | boolean | readonly string[];
  readonly patched_document: string | number | boolean | Record<string, unknown>;
}

export type F041InplaceSelectionRegenerationAuditEntry = BaseFeatureAuditEntry<
  typeof F041_FEATURE_ID
>;

export interface F041InplaceSelectionRegenerationOutput {
  readonly featureId: typeof F041_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F041InplaceSelectionRegenerationExecutionStatus;
  readonly operationCode: typeof F041_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_start_line: string | number;
  readonly resolved_end_line: string | number | boolean | readonly string[];
  readonly resolved_patched_document: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F041InplaceSelectionRegenerationAuditEntry;
}

export type F041InplaceSelectionRegenerationTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F041_FEATURE_ID
>;

export const DEFAULT_F041_CONFIG: F041InplaceSelectionRegenerationConfig = {
  featureId: F041_FEATURE_ID,
  stage: F041_STAGE,
  operationCode: F041_OPERATION_CODE,
  contractVersion: F041_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F041InplaceSelectionRegenerationValidationError extends Error {
  public readonly featureId = F041_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F041 Validation Error on '${field}']: ${message}`);
    this.name = "F041InplaceSelectionRegenerationValidationError";
    this.field = field;
  }
}

export function computeF041Digest(rawPayload: string): string {
  return `f041_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F041InplaceSelectionRegenerationEngine extends KosmoraFeatureAdapterBase<
  typeof F041_FEATURE_ID,
  typeof F041_STAGE,
  typeof F041_OPERATION_CODE,
  F041InplaceSelectionRegenerationConfig,
  F041InplaceSelectionRegenerationInput,
  F041InplaceSelectionRegenerationOutput
> {
  constructor(
    customConfig?: Partial<F041InplaceSelectionRegenerationConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F041_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "start_line", "end_line", "patched_document"] as const,
      F041InplaceSelectionRegenerationValidationError
    );
  }
}

export function verifyF041Module(): {
  featureId: typeof F041_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F041InplaceSelectionRegenerationEngine();
  const sampleInput: F041InplaceSelectionRegenerationInput = {
    requestId: "req_verify_f041",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f041_artifact_id_seed",
    start_line: 42,
    end_line: true,
    patched_document: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 41 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F041" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F041_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
