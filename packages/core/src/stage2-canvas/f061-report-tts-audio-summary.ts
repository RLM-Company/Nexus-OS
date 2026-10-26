/**
 * F061 (stage2-canvas): Аудио-озвучка отчёта (TTS Summary)
 * Генерация краткого голосового брифинга по длинному аналитическому документу
 * Operation Code: tts_briefing_generator
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

export const F061_FEATURE_ID = "F061" as const;
export const F061_STAGE = "stage2-canvas" as const;
export const F061_OPERATION_CODE = "tts_briefing_generator" as const;
export const F061_CONTRACT_VERSION = "2.0.0" as const;

export type F061ReportTtsAudioSummaryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F061ReportTtsAudioSummaryConfig = BaseFeatureConfig<
  typeof F061_FEATURE_ID,
  typeof F061_STAGE,
  typeof F061_OPERATION_CODE
>;

export interface F061ReportTtsAudioSummaryInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly estimated_seconds: string | number;
  readonly ssml_script: string | number | boolean | readonly string[];
  readonly voice_profile: string | number | boolean | Record<string, unknown>;
}

export type F061ReportTtsAudioSummaryAuditEntry = BaseFeatureAuditEntry<typeof F061_FEATURE_ID>;

export interface F061ReportTtsAudioSummaryOutput {
  readonly featureId: typeof F061_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F061ReportTtsAudioSummaryExecutionStatus;
  readonly operationCode: typeof F061_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_estimated_seconds: string | number;
  readonly resolved_ssml_script: string | number | boolean | readonly string[];
  readonly resolved_voice_profile: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F061ReportTtsAudioSummaryAuditEntry;
}

export type F061ReportTtsAudioSummaryTelemetrySnapshot = BaseFeatureTelemetry<typeof F061_FEATURE_ID>;

export const DEFAULT_F061_CONFIG: F061ReportTtsAudioSummaryConfig = {
  featureId: F061_FEATURE_ID,
  stage: F061_STAGE,
  operationCode: F061_OPERATION_CODE,
  contractVersion: F061_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F061ReportTtsAudioSummaryValidationError extends Error {
  public readonly featureId = F061_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F061 Validation Error on '${field}']: ${message}`);
    this.name = "F061ReportTtsAudioSummaryValidationError";
    this.field = field;
  }
}

export function computeF061Digest(rawPayload: string): string {
  return `f061_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F061ReportTtsAudioSummaryEngine extends KosmoraFeatureAdapterBase<
  typeof F061_FEATURE_ID,
  typeof F061_STAGE,
  typeof F061_OPERATION_CODE,
  F061ReportTtsAudioSummaryConfig,
  F061ReportTtsAudioSummaryInput,
  F061ReportTtsAudioSummaryOutput
> {
  constructor(customConfig?: Partial<F061ReportTtsAudioSummaryConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F061_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "estimated_seconds", "ssml_script", "voice_profile"] as const,
      F061ReportTtsAudioSummaryValidationError
    );
  }
}

export function verifyF061Module(): {
  featureId: typeof F061_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F061ReportTtsAudioSummaryEngine();
  const sampleInput: F061ReportTtsAudioSummaryInput = {
    requestId: "req_verify_f061",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f061_artifact_id_seed",
    estimated_seconds: 42,
    ssml_script: true,
    voice_profile: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 61 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F061" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F061_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
