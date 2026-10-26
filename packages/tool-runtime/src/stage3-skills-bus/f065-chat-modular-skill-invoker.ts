/**
 * F065 (stage3-skills-bus): Вызов модульных Skills прямо в чате (/skill или @skill)
 * Быстрое подключение специализированных навыков в активный диалог
 * Operation Code: chat_skill_parser
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

export const F065_FEATURE_ID = "F065" as const;
export const F065_STAGE = "stage3-skills-bus" as const;
export const F065_OPERATION_CODE = "chat_skill_parser" as const;
export const F065_CONTRACT_VERSION = "2.0.0" as const;

export type F065ChatModularSkillInvokerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F065ChatModularSkillInvokerConfig = BaseFeatureConfig<
  typeof F065_FEATURE_ID,
  typeof F065_STAGE,
  typeof F065_OPERATION_CODE
>;

export interface F065ChatModularSkillInvokerInput extends BaseFeatureInput {
  readonly invoked_handle: string;
  readonly parsed_arguments: string | number;
  readonly clean_user_prompt: string | number | boolean | readonly string[];
  readonly skill_bound: string | number | boolean | Record<string, unknown>;
}

export type F065ChatModularSkillInvokerAuditEntry = BaseFeatureAuditEntry<typeof F065_FEATURE_ID>;

export interface F065ChatModularSkillInvokerOutput {
  readonly featureId: typeof F065_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F065ChatModularSkillInvokerExecutionStatus;
  readonly operationCode: typeof F065_OPERATION_CODE;
  readonly resolved_invoked_handle: string;
  readonly resolved_parsed_arguments: string | number;
  readonly resolved_clean_user_prompt: string | number | boolean | readonly string[];
  readonly resolved_skill_bound: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F065ChatModularSkillInvokerAuditEntry;
}

export type F065ChatModularSkillInvokerTelemetrySnapshot = BaseFeatureTelemetry<typeof F065_FEATURE_ID>;

export const DEFAULT_F065_CONFIG: F065ChatModularSkillInvokerConfig = {
  featureId: F065_FEATURE_ID,
  stage: F065_STAGE,
  operationCode: F065_OPERATION_CODE,
  contractVersion: F065_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F065ChatModularSkillInvokerValidationError extends Error {
  public readonly featureId = F065_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F065 Validation Error on '${field}']: ${message}`);
    this.name = "F065ChatModularSkillInvokerValidationError";
    this.field = field;
  }
}

export function computeF065Digest(rawPayload: string): string {
  return `f065_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F065ChatModularSkillInvokerEngine extends KosmoraFeatureAdapterBase<
  typeof F065_FEATURE_ID,
  typeof F065_STAGE,
  typeof F065_OPERATION_CODE,
  F065ChatModularSkillInvokerConfig,
  F065ChatModularSkillInvokerInput,
  F065ChatModularSkillInvokerOutput
> {
  constructor(customConfig?: Partial<F065ChatModularSkillInvokerConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F065_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["invoked_handle", "parsed_arguments", "clean_user_prompt", "skill_bound"] as const,
      F065ChatModularSkillInvokerValidationError
    );
  }
}

export function verifyF065Module(): {
  featureId: typeof F065_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F065ChatModularSkillInvokerEngine();
  const sampleInput: F065ChatModularSkillInvokerInput = {
    requestId: "req_verify_f065",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    invoked_handle: "f065_invoked_handle_seed",
    parsed_arguments: 42,
    clean_user_prompt: true,
    skill_bound: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 65 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F065" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_invoked_handle !== sampleInput.invoked_handle &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F065_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
