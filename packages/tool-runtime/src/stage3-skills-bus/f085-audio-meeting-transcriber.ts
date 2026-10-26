/**
 * F085 (stage3-skills-bus): Транскрибация аудио и записей созвонов
 * Перевод голосовых заметок и митингов в текст с выделением списка задач (Action Items)
 * Operation Code: meeting_action_extractor
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F085_FEATURE_ID = "F085" as const;
export const F085_STAGE = "stage3-skills-bus" as const;
export const F085_OPERATION_CODE = "meeting_action_extractor" as const;
export const F085_CONTRACT_VERSION = "2.0.0" as const;

export type F085AudioMeetingTranscriberExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F085AudioMeetingTranscriberConfig = BaseFeatureConfig<
  typeof F085_FEATURE_ID,
  typeof F085_STAGE,
  typeof F085_OPERATION_CODE
>;

export interface F085AudioMeetingTranscriberInput extends BaseFeatureInput {
  readonly recording_id: string;
  readonly transcript_length: string | number;
  readonly action_items: string | number | boolean | readonly string[];
  readonly assigned_owners: string | number | boolean | Record<string, unknown>;
}

export type F085AudioMeetingTranscriberAuditEntry = BaseFeatureAuditEntry<typeof F085_FEATURE_ID>;

export interface F085AudioMeetingTranscriberOutput {
  readonly featureId: typeof F085_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F085AudioMeetingTranscriberExecutionStatus;
  readonly operationCode: typeof F085_OPERATION_CODE;
  readonly resolved_recording_id: string;
  readonly resolved_transcript_length: string | number;
  readonly resolved_action_items: string | number | boolean | readonly string[];
  readonly resolved_assigned_owners: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F085AudioMeetingTranscriberAuditEntry;
}

export type F085AudioMeetingTranscriberTelemetrySnapshot = BaseFeatureTelemetry<typeof F085_FEATURE_ID>;

export const DEFAULT_F085_CONFIG: F085AudioMeetingTranscriberConfig = {
  featureId: F085_FEATURE_ID,
  stage: F085_STAGE,
  operationCode: F085_OPERATION_CODE,
  contractVersion: F085_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F085AudioMeetingTranscriberValidationError extends Error {
  public readonly featureId = F085_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F085 Validation Error on '${field}']: ${message}`);
    this.name = "F085AudioMeetingTranscriberValidationError";
    this.field = field;
  }
}

export function computeF085Digest(rawPayload: string): string {
  return `f085_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F085AudioMeetingTranscriberEngine extends KosmoraFeatureAdapterBase<
  typeof F085_FEATURE_ID,
  typeof F085_STAGE,
  typeof F085_OPERATION_CODE,
  F085AudioMeetingTranscriberConfig,
  F085AudioMeetingTranscriberInput,
  F085AudioMeetingTranscriberOutput
> {
  constructor(customConfig?: Partial<F085AudioMeetingTranscriberConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F085_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["recording_id", "transcript_length", "action_items", "assigned_owners"] as const,
      F085AudioMeetingTranscriberValidationError
    );
  }
}

export function verifyF085Module(): {
  featureId: typeof F085_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F085AudioMeetingTranscriberEngine();
  const sampleInput: F085AudioMeetingTranscriberInput = {
    requestId: "req_verify_f085",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    recording_id: "f085_recording_id_seed",
    transcript_length: 42,
    action_items: true,
    assigned_owners: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 85 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F085" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_recording_id !== sampleInput.recording_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F085_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
