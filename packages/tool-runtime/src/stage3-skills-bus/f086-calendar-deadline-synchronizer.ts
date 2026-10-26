/**
 * F086 (stage3-skills-bus): Синхронизация с календарём и дедлайнами
 * Привязка этапов выполнения агентных задач к реальному расписанию проекта
 * Operation Code: calendar_milestone_sync
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

export const F086_FEATURE_ID = "F086" as const;
export const F086_STAGE = "stage3-skills-bus" as const;
export const F086_OPERATION_CODE = "calendar_milestone_sync" as const;
export const F086_CONTRACT_VERSION = "2.0.0" as const;

export type F086CalendarDeadlineSynchronizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F086CalendarDeadlineSynchronizerConfig = BaseFeatureConfig<
  typeof F086_FEATURE_ID,
  typeof F086_STAGE,
  typeof F086_OPERATION_CODE
>;

export interface F086CalendarDeadlineSynchronizerInput extends BaseFeatureInput {
  readonly project_id: string;
  readonly milestone_id: string | number;
  readonly deadline_iso: string | number | boolean | readonly string[];
  readonly schedule_aligned: string | number | boolean | Record<string, unknown>;
}

export type F086CalendarDeadlineSynchronizerAuditEntry = BaseFeatureAuditEntry<typeof F086_FEATURE_ID>;

export interface F086CalendarDeadlineSynchronizerOutput {
  readonly featureId: typeof F086_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F086CalendarDeadlineSynchronizerExecutionStatus;
  readonly operationCode: typeof F086_OPERATION_CODE;
  readonly resolved_project_id: string;
  readonly resolved_milestone_id: string | number;
  readonly resolved_deadline_iso: string | number | boolean | readonly string[];
  readonly resolved_schedule_aligned: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F086CalendarDeadlineSynchronizerAuditEntry;
}

export type F086CalendarDeadlineSynchronizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F086_FEATURE_ID>;

export const DEFAULT_F086_CONFIG: F086CalendarDeadlineSynchronizerConfig = {
  featureId: F086_FEATURE_ID,
  stage: F086_STAGE,
  operationCode: F086_OPERATION_CODE,
  contractVersion: F086_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F086CalendarDeadlineSynchronizerValidationError extends Error {
  public readonly featureId = F086_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F086 Validation Error on '${field}']: ${message}`);
    this.name = "F086CalendarDeadlineSynchronizerValidationError";
    this.field = field;
  }
}

export function computeF086Digest(rawPayload: string): string {
  return `f086_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F086CalendarDeadlineSynchronizerEngine extends KosmoraFeatureAdapterBase<
  typeof F086_FEATURE_ID,
  typeof F086_STAGE,
  typeof F086_OPERATION_CODE,
  F086CalendarDeadlineSynchronizerConfig,
  F086CalendarDeadlineSynchronizerInput,
  F086CalendarDeadlineSynchronizerOutput
> {
  constructor(customConfig?: Partial<F086CalendarDeadlineSynchronizerConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F086_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["project_id", "milestone_id", "deadline_iso", "schedule_aligned"] as const,
      F086CalendarDeadlineSynchronizerValidationError
    );
  }
}

export function verifyF086Module(): {
  featureId: typeof F086_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F086CalendarDeadlineSynchronizerEngine();
  const sampleInput: F086CalendarDeadlineSynchronizerInput = {
    requestId: "req_verify_f086",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    project_id: "f086_project_id_seed",
    milestone_id: 42,
    deadline_iso: true,
    schedule_aligned: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 86 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F086" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_project_id !== sampleInput.project_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F086_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
