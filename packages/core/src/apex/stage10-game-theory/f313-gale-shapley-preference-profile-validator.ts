/**
 * F313 (stage10-game-theory): Валидатор двусторонних профилей предпочтений (Gale-Shapley Profile Validator)
 * Проверка строгого порядка предпочтений между пулом агентов-исполнителей и очередью задач
 * Operation Code: galeshapley_profile_validate
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F313_FEATURE_ID = "F313" as const;
export const F313_STAGE = "stage10-game-theory" as const;
export const F313_OPERATION_CODE = "galeshapley_profile_validate" as const;
export const F313_CONTRACT_VERSION = "2.0.0" as const;

export type F313GaleShapleyPreferenceProfileValidatorConfig = BaseFeatureConfig<
  typeof F313_FEATURE_ID,
  typeof F313_STAGE,
  typeof F313_OPERATION_CODE
>;

export interface F313GaleShapleyPreferenceProfileValidatorInput extends BaseFeatureInput {
  readonly proposer_agents: string | number | boolean | readonly string[];
  readonly reviewer_tasks: string | number | boolean | readonly string[];
  readonly agent_preference_map: string | number | boolean | readonly string[];
  readonly task_preference_map: string | number | boolean | readonly string[];
}

export interface F313GaleShapleyPreferenceProfileValidatorOutput {
  readonly featureId: typeof F313_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F313_OPERATION_CODE;
  readonly resolved_proposer_agents: unknown;
  readonly resolved_reviewer_tasks: unknown;
  readonly resolved_agent_preference_map: unknown;
  readonly resolved_task_preference_map: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F313_FEATURE_ID>;
}

export type F313GaleShapleyPreferenceProfileValidatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F313_FEATURE_ID
>;

export const DEFAULT_F313_CONFIG: F313GaleShapleyPreferenceProfileValidatorConfig = {
  featureId: F313_FEATURE_ID,
  stage: F313_STAGE,
  operationCode: F313_OPERATION_CODE,
  contractVersion: F313_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F313GaleShapleyPreferenceProfileValidatorValidationError extends Error {
  public readonly featureId = F313_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F313 Validation Error on '${field}']: ${message}`);
    this.name = "F313GaleShapleyPreferenceProfileValidatorValidationError";
    this.field = field;
  }
}

export function computeF313Digest(rawPayload: string): string {
  return `f313_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F313GaleShapleyPreferenceProfileValidatorService extends KosmoraFeatureAdapterBase<
  typeof F313_FEATURE_ID,
  typeof F313_STAGE,
  typeof F313_OPERATION_CODE,
  F313GaleShapleyPreferenceProfileValidatorConfig,
  F313GaleShapleyPreferenceProfileValidatorInput,
  F313GaleShapleyPreferenceProfileValidatorOutput
> {
  constructor(
    customConfig?: Partial<F313GaleShapleyPreferenceProfileValidatorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F313_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["proposer_agents", "reviewer_tasks", "agent_preference_map", "task_preference_map"] as const,
      F313GaleShapleyPreferenceProfileValidatorValidationError
    );
  }
}

export function verifyF313Module(): {
  readonly featureId: typeof F313_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F313GaleShapleyPreferenceProfileValidatorService();
  const sampleInput: F313GaleShapleyPreferenceProfileValidatorInput = {
    requestId: "req_verify_f313",
    projectId: "proj_kosmora_f313",
    workspaceId: "ws_kosmora_f313",
    tenantId: "tenant_rlm_f313",
    actorId: "actor_verifier_f313",
    autonomyLevel: "A3",
    proposer_agents: "seed_f313_proposer_agents",
    reviewer_tasks: 42,
    agent_preference_map: true,
    task_preference_map: "seed_f313_task_preference_map",
    metadata: { stage: "stage10-game-theory", featureId: "F313" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F313" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_proposer_agents !== sampleInput.proposer_agents &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F313] Verification failed`);
  }

  return {
    featureId: F313_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
