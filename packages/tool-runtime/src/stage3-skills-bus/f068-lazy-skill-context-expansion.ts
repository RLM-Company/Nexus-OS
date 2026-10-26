/**
 * F068 (stage3-skills-bus): Горячая подгрузка контекста скилла (Lazy Skill Expansion)
 * Подтягивание тяжёлых инструкций скилла только в момент его реального вызова
 * Operation Code: lazy_skill_loader
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

export const F068_FEATURE_ID = "F068" as const;
export const F068_STAGE = "stage3-skills-bus" as const;
export const F068_OPERATION_CODE = "lazy_skill_loader" as const;
export const F068_CONTRACT_VERSION = "2.0.0" as const;

export type F068LazySkillContextExpansionExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F068LazySkillContextExpansionConfig = BaseFeatureConfig<
  typeof F068_FEATURE_ID,
  typeof F068_STAGE,
  typeof F068_OPERATION_CODE
>;

export interface F068LazySkillContextExpansionInput extends BaseFeatureInput {
  readonly skill_handle: string;
  readonly loaded_on_demand: string | number;
  readonly tokens_saved_while_idle: string | number | boolean | readonly string[];
  readonly expanded_instructions: string | number | boolean | Record<string, unknown>;
}

export type F068LazySkillContextExpansionAuditEntry = BaseFeatureAuditEntry<typeof F068_FEATURE_ID>;

export interface F068LazySkillContextExpansionOutput {
  readonly featureId: typeof F068_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F068LazySkillContextExpansionExecutionStatus;
  readonly operationCode: typeof F068_OPERATION_CODE;
  readonly resolved_skill_handle: string;
  readonly resolved_loaded_on_demand: string | number;
  readonly resolved_tokens_saved_while_idle: string | number | boolean | readonly string[];
  readonly resolved_expanded_instructions: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F068LazySkillContextExpansionAuditEntry;
}

export type F068LazySkillContextExpansionTelemetrySnapshot = BaseFeatureTelemetry<typeof F068_FEATURE_ID>;

export const DEFAULT_F068_CONFIG: F068LazySkillContextExpansionConfig = {
  featureId: F068_FEATURE_ID,
  stage: F068_STAGE,
  operationCode: F068_OPERATION_CODE,
  contractVersion: F068_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F068LazySkillContextExpansionValidationError extends Error {
  public readonly featureId = F068_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F068 Validation Error on '${field}']: ${message}`);
    this.name = "F068LazySkillContextExpansionValidationError";
    this.field = field;
  }
}

export function computeF068Digest(rawPayload: string): string {
  return `f068_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F068LazySkillContextExpansionEngine extends KosmoraFeatureAdapterBase<
  typeof F068_FEATURE_ID,
  typeof F068_STAGE,
  typeof F068_OPERATION_CODE,
  F068LazySkillContextExpansionConfig,
  F068LazySkillContextExpansionInput,
  F068LazySkillContextExpansionOutput
> {
  constructor(customConfig?: Partial<F068LazySkillContextExpansionConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F068_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["skill_handle", "loaded_on_demand", "tokens_saved_while_idle", "expanded_instructions"] as const,
      F068LazySkillContextExpansionValidationError
    );
  }
}

export function verifyF068Module(): {
  featureId: typeof F068_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F068LazySkillContextExpansionEngine();
  const sampleInput: F068LazySkillContextExpansionInput = {
    requestId: "req_verify_f068",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_handle: "f068_skill_handle_seed",
    loaded_on_demand: 42,
    tokens_saved_while_idle: true,
    expanded_instructions: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 68 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F068" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_skill_handle !== sampleInput.skill_handle &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F068_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
