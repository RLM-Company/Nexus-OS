/**
 * F305 (stage10-game-theory): Построитель матрицы попарных предпочтений Кондорсе (Pairwise Matrix Builder)
 * Подсчёт числа бюллетеней агентов-экспертов, в которых кандидат A строго предпочтительнее кандидата B
 * Operation Code: schulze_pairwise_matrix
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

export const F305_FEATURE_ID = "F305" as const;
export const F305_STAGE = "stage10-game-theory" as const;
export const F305_OPERATION_CODE = "schulze_pairwise_matrix" as const;
export const F305_CONTRACT_VERSION = "2.0.0" as const;

export type F305SchulzePairwisePreferenceMatrixBuilderConfig = BaseFeatureConfig<
  typeof F305_FEATURE_ID,
  typeof F305_STAGE,
  typeof F305_OPERATION_CODE
>;

export interface F305SchulzePairwisePreferenceMatrixBuilderInput extends BaseFeatureInput {
  readonly candidate_options: string | number | boolean | readonly string[];
  readonly voter_ballots: string | number | boolean | readonly string[];
  readonly ballot_weights: string | number | boolean | readonly string[];
  readonly tie_break_seed: string | number | boolean | readonly string[];
}

export interface F305SchulzePairwisePreferenceMatrixBuilderOutput {
  readonly featureId: typeof F305_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F305_OPERATION_CODE;
  readonly resolved_candidate_options: unknown;
  readonly resolved_voter_ballots: unknown;
  readonly resolved_ballot_weights: unknown;
  readonly resolved_tie_break_seed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F305_FEATURE_ID>;
}

export type F305SchulzePairwisePreferenceMatrixBuilderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F305_FEATURE_ID
>;

export const DEFAULT_F305_CONFIG: F305SchulzePairwisePreferenceMatrixBuilderConfig = {
  featureId: F305_FEATURE_ID,
  stage: F305_STAGE,
  operationCode: F305_OPERATION_CODE,
  contractVersion: F305_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F305SchulzePairwisePreferenceMatrixBuilderValidationError extends Error {
  public readonly featureId = F305_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F305 Validation Error on '${field}']: ${message}`);
    this.name = "F305SchulzePairwisePreferenceMatrixBuilderValidationError";
    this.field = field;
  }
}

export function computeF305Digest(rawPayload: string): string {
  return `f305_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F305SchulzePairwisePreferenceMatrixBuilderService extends KosmoraFeatureAdapterBase<
  typeof F305_FEATURE_ID,
  typeof F305_STAGE,
  typeof F305_OPERATION_CODE,
  F305SchulzePairwisePreferenceMatrixBuilderConfig,
  F305SchulzePairwisePreferenceMatrixBuilderInput,
  F305SchulzePairwisePreferenceMatrixBuilderOutput
> {
  constructor(
    customConfig?: Partial<F305SchulzePairwisePreferenceMatrixBuilderConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F305_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["candidate_options", "voter_ballots", "ballot_weights", "tie_break_seed"] as const,
      F305SchulzePairwisePreferenceMatrixBuilderValidationError
    );
  }
}

export function verifyF305Module(): {
  readonly featureId: typeof F305_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F305SchulzePairwisePreferenceMatrixBuilderService();
  const sampleInput: F305SchulzePairwisePreferenceMatrixBuilderInput = {
    requestId: "req_verify_f305",
    projectId: "proj_kosmora_f305",
    workspaceId: "ws_kosmora_f305",
    tenantId: "tenant_rlm_f305",
    actorId: "actor_verifier_f305",
    autonomyLevel: "A3",
    candidate_options: "seed_f305_candidate_options",
    voter_ballots: 42,
    ballot_weights: true,
    tie_break_seed: "seed_f305_tie_break_seed",
    metadata: { stage: "stage10-game-theory", featureId: "F305" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F305" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_options !== sampleInput.candidate_options &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F305] Verification failed`);
  }

  return {
    featureId: F305_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
