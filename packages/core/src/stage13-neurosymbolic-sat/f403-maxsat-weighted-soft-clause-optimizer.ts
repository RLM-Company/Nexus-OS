import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage13NeurosymbolicSatKernel } from "./stage-kernel.js";

export const F403_FEATURE_ID = "F403" as const;
export const F403_STAGE = "stage13-neurosymbolic-sat" as const;
export const F403_OPERATION_CODE = "F403_MAXSAT_WEIGHTED_SOFT_CLAUSE_OPTIMIZER" as const;
export const F403_CONTRACT_VERSION = "2.0.0" as const;

export type F403MaxsatWeightedSoftClauseOptimizerConfig = BaseFeatureConfig<
  typeof F403_FEATURE_ID,
  typeof F403_STAGE,
  typeof F403_OPERATION_CODE
>;

export interface F403MaxsatWeightedSoftClauseOptimizerInput extends BaseFeatureInput {
  readonly hard_clauses: string | number | boolean | readonly string[];
  readonly weighted_soft_clauses: string | number | boolean | readonly string[];
  readonly branch_and_bound_limit: string | number | boolean | readonly string[];
  readonly initial_assignment: string | number | boolean | readonly string[];
}

export interface F403MaxsatWeightedSoftClauseOptimizerOutput {
  readonly featureId: typeof F403_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F403_OPERATION_CODE;
  readonly resolved_hard_clauses: unknown;
  readonly resolved_weighted_soft_clauses: unknown;
  readonly resolved_branch_and_bound_limit: unknown;
  readonly resolved_initial_assignment: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F403_FEATURE_ID>;
}

export type F403MaxsatWeightedSoftClauseOptimizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F403_FEATURE_ID>;

export const DEFAULT_F403_CONFIG: F403MaxsatWeightedSoftClauseOptimizerConfig = {
  featureId: F403_FEATURE_ID,
  stage: F403_STAGE,
  operationCode: F403_OPERATION_CODE,
  contractVersion: F403_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F403MaxsatWeightedSoftClauseOptimizerValidationError extends Error {
  public readonly featureId = F403_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F403 Validation Error on '${field}']: ${message}`);
    this.name = "F403MaxsatWeightedSoftClauseOptimizerValidationError";
    this.field = field;
  }
}

export function computeF403Digest(rawPayload: string): string {
  return `f403_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F403MaxsatWeightedSoftClauseOptimizerService extends KosmoraFeatureAdapterBase<
  typeof F403_FEATURE_ID,
  typeof F403_STAGE,
  typeof F403_OPERATION_CODE,
  F403MaxsatWeightedSoftClauseOptimizerConfig,
  F403MaxsatWeightedSoftClauseOptimizerInput,
  F403MaxsatWeightedSoftClauseOptimizerOutput
> {
  constructor(customConfig?: Partial<F403MaxsatWeightedSoftClauseOptimizerConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F403_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["hard_clauses", "weighted_soft_clauses", "branch_and_bound_limit", "initial_assignment"] as const,
      F403MaxsatWeightedSoftClauseOptimizerValidationError
    );
  }
}

export function verifyF403Module(): {
  readonly featureId: typeof F403_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F403MaxsatWeightedSoftClauseOptimizerService();
  const sampleInput: F403MaxsatWeightedSoftClauseOptimizerInput = {
    requestId: "req_verify_f403",
    projectId: "proj_kosmora_f403",
    workspaceId: "ws_kosmora_f403",
    tenantId: "tenant_rlm_f403",
    actorId: "actor_verifier_f403",
    autonomyLevel: "A3",
    hard_clauses: "seed_f403_hard_clauses",
    weighted_soft_clauses: 42,
    branch_and_bound_limit: true,
    initial_assignment: "seed_f403_initial_assignment",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F403" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F403" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_hard_clauses !== sampleInput.hard_clauses &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F403] Verification failed`);
  }

  return {
    featureId: F403_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
