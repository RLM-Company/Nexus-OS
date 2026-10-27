/**
 * F330 (stage11-causal-bayesian): Исполнитель гипотетического действия в контрфактическом мире (Step 2: Action)
 * Фиксация альтернативного решения агента do(X = x') при сохранении восстановленного фона U
 * Operation Code: cf_action_mutator
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
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F330_FEATURE_ID = "F330" as const;
export const F330_STAGE = "stage11-causal-bayesian" as const;
export const F330_OPERATION_CODE = "cf_action_mutator" as const;
export const F330_CONTRACT_VERSION = "2.0.0" as const;

export type F330CounterfactualStructuralActionMutatorConfig = BaseFeatureConfig<
  typeof F330_FEATURE_ID,
  typeof F330_STAGE,
  typeof F330_OPERATION_CODE
>;

export interface F330CounterfactualStructuralActionMutatorInput extends BaseFeatureInput {
  readonly abducted_state_id: string | number | boolean | readonly string[];
  readonly hypothetical_var: string | number | boolean | readonly string[];
  readonly hypothetical_val: string | number | boolean | readonly string[];
  readonly modified_scm_id: string | number | boolean | readonly string[];
}

export interface F330CounterfactualStructuralActionMutatorOutput {
  readonly featureId: typeof F330_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F330_OPERATION_CODE;
  readonly resolved_abducted_state_id: unknown;
  readonly resolved_hypothetical_var: unknown;
  readonly resolved_hypothetical_val: unknown;
  readonly resolved_modified_scm_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F330_FEATURE_ID>;
}

export type F330CounterfactualStructuralActionMutatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F330_FEATURE_ID
>;

export const DEFAULT_F330_CONFIG: F330CounterfactualStructuralActionMutatorConfig = {
  featureId: F330_FEATURE_ID,
  stage: F330_STAGE,
  operationCode: F330_OPERATION_CODE,
  contractVersion: F330_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F330CounterfactualStructuralActionMutatorValidationError extends Error {
  public readonly featureId = F330_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F330 Validation Error on '${field}']: ${message}`);
    this.name = "F330CounterfactualStructuralActionMutatorValidationError";
    this.field = field;
  }
}

export function computeF330Digest(rawPayload: string): string {
  return `f330_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F330CounterfactualStructuralActionMutatorService extends KosmoraFeatureAdapterBase<
  typeof F330_FEATURE_ID,
  typeof F330_STAGE,
  typeof F330_OPERATION_CODE,
  F330CounterfactualStructuralActionMutatorConfig,
  F330CounterfactualStructuralActionMutatorInput,
  F330CounterfactualStructuralActionMutatorOutput
> {
  constructor(
    customConfig?: Partial<F330CounterfactualStructuralActionMutatorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F330_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["abducted_state_id", "hypothetical_var", "hypothetical_val", "modified_scm_id"] as const,
      F330CounterfactualStructuralActionMutatorValidationError
    );
  }
}

export function verifyF330Module(): {
  readonly featureId: typeof F330_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F330CounterfactualStructuralActionMutatorService();
  const sampleInput: F330CounterfactualStructuralActionMutatorInput = {
    requestId: "req_verify_f330",
    projectId: "proj_kosmora_f330",
    workspaceId: "ws_kosmora_f330",
    tenantId: "tenant_rlm_f330",
    actorId: "actor_verifier_f330",
    autonomyLevel: "A3",
    abducted_state_id: "seed_f330_abducted_state_id",
    hypothetical_var: 42,
    hypothetical_val: true,
    modified_scm_id: "seed_f330_modified_scm_id",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F330" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F330" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_abducted_state_id !== sampleInput.abducted_state_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F330] Verification failed`);
  }

  return {
    featureId: F330_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
