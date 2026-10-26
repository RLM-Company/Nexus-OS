/**
 * F298 (stage10-game-theory): Оптимизатор общественного благосостояния в аукционе Викри-Кларка-Гровса
 * Поиск назначения агентов по задачам, максимизирующего суммарную полезность (качество минус издержки)
 * Operation Code: vcg_cost_minimizer
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

export const F298_FEATURE_ID = "F298" as const;
export const F298_STAGE = "stage10-game-theory" as const;
export const F298_OPERATION_CODE = "vcg_cost_minimizer" as const;
export const F298_CONTRACT_VERSION = "2.0.0" as const;

export type F298VcgSocialWelfareCostMinimizerConfig = BaseFeatureConfig<
  typeof F298_FEATURE_ID,
  typeof F298_STAGE,
  typeof F298_OPERATION_CODE
>;

export interface F298VcgSocialWelfareCostMinimizerInput extends BaseFeatureInput {
  readonly candidate_assignments: string | number | boolean | readonly string[];
  readonly bid_cost_table: string | number | boolean | readonly string[];
  readonly slot_constraints: string | number | boolean | readonly string[];
  readonly optimization_goal: string | number | boolean | readonly string[];
}

export interface F298VcgSocialWelfareCostMinimizerOutput {
  readonly featureId: typeof F298_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F298_OPERATION_CODE;
  readonly resolved_candidate_assignments: unknown;
  readonly resolved_bid_cost_table: unknown;
  readonly resolved_slot_constraints: unknown;
  readonly resolved_optimization_goal: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F298_FEATURE_ID>;
}

export type F298VcgSocialWelfareCostMinimizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F298_FEATURE_ID
>;

export const DEFAULT_F298_CONFIG: F298VcgSocialWelfareCostMinimizerConfig = {
  featureId: F298_FEATURE_ID,
  stage: F298_STAGE,
  operationCode: F298_OPERATION_CODE,
  contractVersion: F298_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F298VcgSocialWelfareCostMinimizerValidationError extends Error {
  public readonly featureId = F298_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F298 Validation Error on '${field}']: ${message}`);
    this.name = "F298VcgSocialWelfareCostMinimizerValidationError";
    this.field = field;
  }
}

export function computeF298Digest(rawPayload: string): string {
  return `f298_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F298VcgSocialWelfareCostMinimizerService extends KosmoraFeatureAdapterBase<
  typeof F298_FEATURE_ID,
  typeof F298_STAGE,
  typeof F298_OPERATION_CODE,
  F298VcgSocialWelfareCostMinimizerConfig,
  F298VcgSocialWelfareCostMinimizerInput,
  F298VcgSocialWelfareCostMinimizerOutput
> {
  constructor(
    customConfig?: Partial<F298VcgSocialWelfareCostMinimizerConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F298_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["candidate_assignments", "bid_cost_table", "slot_constraints", "optimization_goal"] as const,
      F298VcgSocialWelfareCostMinimizerValidationError
    );
  }
}

export function verifyF298Module(): {
  readonly featureId: typeof F298_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F298VcgSocialWelfareCostMinimizerService();
  const sampleInput: F298VcgSocialWelfareCostMinimizerInput = {
    requestId: "req_verify_f298",
    projectId: "proj_kosmora_f298",
    workspaceId: "ws_kosmora_f298",
    tenantId: "tenant_rlm_f298",
    actorId: "actor_verifier_f298",
    autonomyLevel: "A3",
    candidate_assignments: "seed_f298_candidate_assignments",
    bid_cost_table: 42,
    slot_constraints: true,
    optimization_goal: "seed_f298_optimization_goal",
    metadata: { stage: "stage10-game-theory", featureId: "F298" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F298" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_assignments !== sampleInput.candidate_assignments &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F298] Verification failed`);
  }

  return {
    featureId: F298_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
