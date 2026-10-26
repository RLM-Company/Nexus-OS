/**
 * F189 (stage6-sovereign-cluster): Автоматическая публикация проверенных композитных скиллов
 * Перевод дистиллированного навыка в активный реестр после прохождения канареечного бенчмарка
 * Operation Code: self_evolving_skill_promoter
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F189_FEATURE_ID = "F189" as const;
export const F189_STAGE = "stage6-sovereign-cluster" as const;
export const F189_OPERATION_CODE = "self_evolving_skill_promoter" as const;
export const F189_CONTRACT_VERSION = "2.0.0" as const;

export type F189SelfEvolvingSkillPromoterExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F189SelfEvolvingSkillPromoterConfig = BaseFeatureConfig<
  typeof F189_FEATURE_ID,
  typeof F189_STAGE,
  typeof F189_OPERATION_CODE
>;

export interface F189SelfEvolvingSkillPromoterInput extends BaseFeatureInput {
  readonly skill_id: string;
  readonly skill_name: string | number;
  readonly promoted: string | number | boolean | readonly string[];
  readonly determinism_digest: string | number | boolean | Record<string, unknown>;
}

export type F189SelfEvolvingSkillPromoterAuditEntry = BaseFeatureAuditEntry<typeof F189_FEATURE_ID>;

export interface F189SelfEvolvingSkillPromoterOutput {
  readonly featureId: typeof F189_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F189SelfEvolvingSkillPromoterExecutionStatus;
  readonly operationCode: typeof F189_OPERATION_CODE;
  readonly resolved_skill_id: string;
  readonly resolved_skill_name: string | number;
  readonly resolved_promoted: string | number | boolean | readonly string[];
  readonly resolved_determinism_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F189SelfEvolvingSkillPromoterAuditEntry;
}

export type F189SelfEvolvingSkillPromoterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F189_FEATURE_ID
>;

export const DEFAULT_F189_CONFIG: F189SelfEvolvingSkillPromoterConfig = {
  featureId: F189_FEATURE_ID,
  stage: F189_STAGE,
  operationCode: F189_OPERATION_CODE,
  contractVersion: F189_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F189SelfEvolvingSkillPromoterValidationError extends Error {
  public readonly featureId = F189_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F189 Validation Error on '${field}']: ${message}`);
    this.name = "F189SelfEvolvingSkillPromoterValidationError";
    this.field = field;
  }
}

export function computeF189Digest(rawPayload: string): string {
  return `f189_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F189SelfEvolvingSkillPromoterEngine extends KosmoraFeatureAdapterBase<
  typeof F189_FEATURE_ID,
  typeof F189_STAGE,
  typeof F189_OPERATION_CODE,
  F189SelfEvolvingSkillPromoterConfig,
  F189SelfEvolvingSkillPromoterInput,
  F189SelfEvolvingSkillPromoterOutput
> {
  constructor(
    customConfig?: Partial<F189SelfEvolvingSkillPromoterConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F189_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["skill_id", "skill_name", "promoted", "determinism_digest"] as const,
      F189SelfEvolvingSkillPromoterValidationError
    );
  }
}

export function verifyF189Module(): {
  featureId: typeof F189_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F189SelfEvolvingSkillPromoterEngine();
  const sampleInput: F189SelfEvolvingSkillPromoterInput = {
    requestId: "req_verify_f189",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_id: "f189_skill_id_seed",
    skill_name: 42,
    promoted: true,
    determinism_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 189 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F189" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_skill_id !== sampleInput.skill_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F189_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
