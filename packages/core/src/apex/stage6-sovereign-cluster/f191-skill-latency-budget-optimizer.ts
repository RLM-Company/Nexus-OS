/**
 * F191 (stage6-sovereign-cluster): Контроль скоростного бюджета дистиллированных скиллов
 * Измерение средней длительности шагов траектории и блокировка деградировавших цепочек
 * Operation Code: skill_latency_budget_optimizer
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

export const F191_FEATURE_ID = "F191" as const;
export const F191_STAGE = "stage6-sovereign-cluster" as const;
export const F191_OPERATION_CODE = "skill_latency_budget_optimizer" as const;
export const F191_CONTRACT_VERSION = "2.0.0" as const;

export type F191SkillLatencyBudgetOptimizerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F191SkillLatencyBudgetOptimizerConfig = BaseFeatureConfig<
  typeof F191_FEATURE_ID,
  typeof F191_STAGE,
  typeof F191_OPERATION_CODE
>;

export interface F191SkillLatencyBudgetOptimizerInput extends BaseFeatureInput {
  readonly skill_id: string;
  readonly avg_latency_ms: string | number;
  readonly synthesized_steps_count: string | number | boolean | readonly string[];
  readonly promoted: string | number | boolean | Record<string, unknown>;
}

export type F191SkillLatencyBudgetOptimizerAuditEntry = BaseFeatureAuditEntry<
  typeof F191_FEATURE_ID
>;

export interface F191SkillLatencyBudgetOptimizerOutput {
  readonly featureId: typeof F191_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F191SkillLatencyBudgetOptimizerExecutionStatus;
  readonly operationCode: typeof F191_OPERATION_CODE;
  readonly resolved_skill_id: string;
  readonly resolved_avg_latency_ms: string | number;
  readonly resolved_synthesized_steps_count: string | number | boolean | readonly string[];
  readonly resolved_promoted: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F191SkillLatencyBudgetOptimizerAuditEntry;
}

export type F191SkillLatencyBudgetOptimizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F191_FEATURE_ID
>;

export const DEFAULT_F191_CONFIG: F191SkillLatencyBudgetOptimizerConfig = {
  featureId: F191_FEATURE_ID,
  stage: F191_STAGE,
  operationCode: F191_OPERATION_CODE,
  contractVersion: F191_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F191SkillLatencyBudgetOptimizerValidationError extends Error {
  public readonly featureId = F191_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F191 Validation Error on '${field}']: ${message}`);
    this.name = "F191SkillLatencyBudgetOptimizerValidationError";
    this.field = field;
  }
}

export function computeF191Digest(rawPayload: string): string {
  return `f191_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F191SkillLatencyBudgetOptimizerEngine extends KosmoraFeatureAdapterBase<
  typeof F191_FEATURE_ID,
  typeof F191_STAGE,
  typeof F191_OPERATION_CODE,
  F191SkillLatencyBudgetOptimizerConfig,
  F191SkillLatencyBudgetOptimizerInput,
  F191SkillLatencyBudgetOptimizerOutput
> {
  constructor(
    customConfig?: Partial<F191SkillLatencyBudgetOptimizerConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F191_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["skill_id", "avg_latency_ms", "synthesized_steps_count", "promoted"] as const,
      F191SkillLatencyBudgetOptimizerValidationError
    );
  }
}

export function verifyF191Module(): {
  featureId: typeof F191_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F191SkillLatencyBudgetOptimizerEngine();
  const sampleInput: F191SkillLatencyBudgetOptimizerInput = {
    requestId: "req_verify_f191",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_id: "f191_skill_id_seed",
    avg_latency_ms: 42,
    synthesized_steps_count: true,
    promoted: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 191 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F191" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_skill_id !== sampleInput.skill_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F191_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
