/**
 * F095 (stage3-skills-bus): Цепочки скиллов (Skill Chaining)
 * Автоматическая передача выхода одного скилла на вход другому
 * Operation Code: skill_pipeline_chainer
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

export const F095_FEATURE_ID = "F095" as const;
export const F095_STAGE = "stage3-skills-bus" as const;
export const F095_OPERATION_CODE = "skill_pipeline_chainer" as const;
export const F095_CONTRACT_VERSION = "2.0.0" as const;

export type F095AutomatedSkillChainingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F095AutomatedSkillChainingConfig = BaseFeatureConfig<
  typeof F095_FEATURE_ID,
  typeof F095_STAGE,
  typeof F095_OPERATION_CODE
>;

export interface F095AutomatedSkillChainingInput extends BaseFeatureInput {
  readonly chain_id: string;
  readonly ordered_skill_handles: string | number;
  readonly intermediate_artifacts: string | number | boolean | readonly string[];
  readonly final_payload: string | number | boolean | Record<string, unknown>;
}

export type F095AutomatedSkillChainingAuditEntry = BaseFeatureAuditEntry<typeof F095_FEATURE_ID>;

export interface F095AutomatedSkillChainingOutput {
  readonly featureId: typeof F095_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F095AutomatedSkillChainingExecutionStatus;
  readonly operationCode: typeof F095_OPERATION_CODE;
  readonly resolved_chain_id: string;
  readonly resolved_ordered_skill_handles: string | number;
  readonly resolved_intermediate_artifacts: string | number | boolean | readonly string[];
  readonly resolved_final_payload: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F095AutomatedSkillChainingAuditEntry;
}

export type F095AutomatedSkillChainingTelemetrySnapshot = BaseFeatureTelemetry<typeof F095_FEATURE_ID>;

export const DEFAULT_F095_CONFIG: F095AutomatedSkillChainingConfig = {
  featureId: F095_FEATURE_ID,
  stage: F095_STAGE,
  operationCode: F095_OPERATION_CODE,
  contractVersion: F095_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F095AutomatedSkillChainingValidationError extends Error {
  public readonly featureId = F095_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F095 Validation Error on '${field}']: ${message}`);
    this.name = "F095AutomatedSkillChainingValidationError";
    this.field = field;
  }
}

export function computeF095Digest(rawPayload: string): string {
  return `f095_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F095AutomatedSkillChainingEngine extends KosmoraFeatureAdapterBase<
  typeof F095_FEATURE_ID,
  typeof F095_STAGE,
  typeof F095_OPERATION_CODE,
  F095AutomatedSkillChainingConfig,
  F095AutomatedSkillChainingInput,
  F095AutomatedSkillChainingOutput
> {
  constructor(customConfig?: Partial<F095AutomatedSkillChainingConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F095_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["chain_id", "ordered_skill_handles", "intermediate_artifacts", "final_payload"] as const,
      F095AutomatedSkillChainingValidationError
    );
  }
}

export function verifyF095Module(): {
  featureId: typeof F095_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F095AutomatedSkillChainingEngine();
  const sampleInput: F095AutomatedSkillChainingInput = {
    requestId: "req_verify_f095",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    chain_id: "f095_chain_id_seed",
    ordered_skill_handles: 42,
    intermediate_artifacts: true,
    final_payload: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 95 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F095" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_chain_id !== sampleInput.chain_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F095_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
