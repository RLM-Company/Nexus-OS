/**
 * F067 (stage3-skills-bus): Конструктор кастомных Skills
 * Упаковка успешного промпт-пайплайна и набора скриптов в переиспользуемый скилл
 * Operation Code: skill_packager
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

export const F067_FEATURE_ID = "F067" as const;
export const F067_STAGE = "stage3-skills-bus" as const;
export const F067_OPERATION_CODE = "skill_packager" as const;
export const F067_CONTRACT_VERSION = "2.0.0" as const;

export type F067CustomSkillBuilderExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F067CustomSkillBuilderConfig = BaseFeatureConfig<
  typeof F067_FEATURE_ID,
  typeof F067_STAGE,
  typeof F067_OPERATION_CODE
>;

export interface F067CustomSkillBuilderInput extends BaseFeatureInput {
  readonly custom_skill_id: string;
  readonly pipeline_steps: string | number;
  readonly manifest_valid: string | number | boolean | readonly string[];
  readonly packaged_bundle: string | number | boolean | Record<string, unknown>;
}

export type F067CustomSkillBuilderAuditEntry = BaseFeatureAuditEntry<typeof F067_FEATURE_ID>;

export interface F067CustomSkillBuilderOutput {
  readonly featureId: typeof F067_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F067CustomSkillBuilderExecutionStatus;
  readonly operationCode: typeof F067_OPERATION_CODE;
  readonly resolved_custom_skill_id: string;
  readonly resolved_pipeline_steps: string | number;
  readonly resolved_manifest_valid: string | number | boolean | readonly string[];
  readonly resolved_packaged_bundle: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F067CustomSkillBuilderAuditEntry;
}

export type F067CustomSkillBuilderTelemetrySnapshot = BaseFeatureTelemetry<typeof F067_FEATURE_ID>;

export const DEFAULT_F067_CONFIG: F067CustomSkillBuilderConfig = {
  featureId: F067_FEATURE_ID,
  stage: F067_STAGE,
  operationCode: F067_OPERATION_CODE,
  contractVersion: F067_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F067CustomSkillBuilderValidationError extends Error {
  public readonly featureId = F067_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F067 Validation Error on '${field}']: ${message}`);
    this.name = "F067CustomSkillBuilderValidationError";
    this.field = field;
  }
}

export function computeF067Digest(rawPayload: string): string {
  return `f067_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F067CustomSkillBuilderEngine extends KosmoraFeatureAdapterBase<
  typeof F067_FEATURE_ID,
  typeof F067_STAGE,
  typeof F067_OPERATION_CODE,
  F067CustomSkillBuilderConfig,
  F067CustomSkillBuilderInput,
  F067CustomSkillBuilderOutput
> {
  constructor(customConfig?: Partial<F067CustomSkillBuilderConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F067_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["custom_skill_id", "pipeline_steps", "manifest_valid", "packaged_bundle"] as const,
      F067CustomSkillBuilderValidationError
    );
  }
}

export function verifyF067Module(): {
  featureId: typeof F067_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F067CustomSkillBuilderEngine();
  const sampleInput: F067CustomSkillBuilderInput = {
    requestId: "req_verify_f067",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    custom_skill_id: "f067_custom_skill_id_seed",
    pipeline_steps: 42,
    manifest_valid: true,
    packaged_bundle: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 67 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F067" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_custom_skill_id !== sampleInput.custom_skill_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F067_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
