/**
 * F289 (stage10-game-theory): Вычислитель предельного вклада агентов в коалициях (Marginal Contribution Evaluator)
 * Оценка прироста ценности v(S U {i}) - v(S) по всем 2^(n-1) подмножествам коалиции агентов
 * Operation Code: shapley_marginal_eval
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

export const F289_FEATURE_ID = "F289" as const;
export const F289_STAGE = "stage10-game-theory" as const;
export const F289_OPERATION_CODE = "shapley_marginal_eval" as const;
export const F289_CONTRACT_VERSION = "2.0.0" as const;

export type F289ShapleyCoalitionMarginalEvaluatorConfig = BaseFeatureConfig<
  typeof F289_FEATURE_ID,
  typeof F289_STAGE,
  typeof F289_OPERATION_CODE
>;

export interface F289ShapleyCoalitionMarginalEvaluatorInput extends BaseFeatureInput {
  readonly coalition_agents: string | number | boolean | readonly string[];
  readonly characteristic_values: string | number | boolean | readonly string[];
  readonly target_agent_id: string | number | boolean | readonly string[];
  readonly permutation_mode: string | number | boolean | readonly string[];
}

export interface F289ShapleyCoalitionMarginalEvaluatorOutput {
  readonly featureId: typeof F289_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F289_OPERATION_CODE;
  readonly resolved_coalition_agents: unknown;
  readonly resolved_characteristic_values: unknown;
  readonly resolved_target_agent_id: unknown;
  readonly resolved_permutation_mode: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F289_FEATURE_ID>;
}

export type F289ShapleyCoalitionMarginalEvaluatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F289_FEATURE_ID>;

export const DEFAULT_F289_CONFIG: F289ShapleyCoalitionMarginalEvaluatorConfig = {
  featureId: F289_FEATURE_ID,
  stage: F289_STAGE,
  operationCode: F289_OPERATION_CODE,
  contractVersion: F289_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F289ShapleyCoalitionMarginalEvaluatorValidationError extends Error {
  public readonly featureId = F289_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F289 Validation Error on '${field}']: ${message}`);
    this.name = "F289ShapleyCoalitionMarginalEvaluatorValidationError";
    this.field = field;
  }
}

export function computeF289Digest(rawPayload: string): string {
  return `f289_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F289ShapleyCoalitionMarginalEvaluatorService extends KosmoraFeatureAdapterBase<
  typeof F289_FEATURE_ID,
  typeof F289_STAGE,
  typeof F289_OPERATION_CODE,
  F289ShapleyCoalitionMarginalEvaluatorConfig,
  F289ShapleyCoalitionMarginalEvaluatorInput,
  F289ShapleyCoalitionMarginalEvaluatorOutput
> {
  constructor(customConfig?: Partial<F289ShapleyCoalitionMarginalEvaluatorConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F289_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["coalition_agents", "characteristic_values", "target_agent_id", "permutation_mode"] as const,
      F289ShapleyCoalitionMarginalEvaluatorValidationError
    );
  }
}

export function verifyF289Module(): {
  readonly featureId: typeof F289_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F289ShapleyCoalitionMarginalEvaluatorService();
  const sampleInput: F289ShapleyCoalitionMarginalEvaluatorInput = {
    requestId: "req_verify_f289",
    projectId: "proj_kosmora_f289",
    workspaceId: "ws_kosmora_f289",
    tenantId: "tenant_rlm_f289",
    actorId: "actor_verifier_f289",
    autonomyLevel: "A3",
    coalition_agents: "seed_f289_coalition_agents",
    characteristic_values: 42,
    target_agent_id: true,
    permutation_mode: "seed_f289_permutation_mode",
    metadata: { stage: "stage10-game-theory", featureId: "F289" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F289" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_coalition_agents !== sampleInput.coalition_agents &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F289] Verification failed`);
  }

  return {
    featureId: F289_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
