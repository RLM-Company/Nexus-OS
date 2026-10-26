/**
 * F307 (stage10-game-theory): Сертификатор победителя Кондорсе по методу Шульце
 * Определение решения, побеждающего все остальные альтернативы по сильнейшим путям предпочтений
 * Operation Code: schulze_condorcet_certify
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

export const F307_FEATURE_ID = "F307" as const;
export const F307_STAGE = "stage10-game-theory" as const;
export const F307_OPERATION_CODE = "schulze_condorcet_certify" as const;
export const F307_CONTRACT_VERSION = "2.0.0" as const;

export type F307SchulzeCondorcetWinnerCertifierConfig = BaseFeatureConfig<
  typeof F307_FEATURE_ID,
  typeof F307_STAGE,
  typeof F307_OPERATION_CODE
>;

export interface F307SchulzeCondorcetWinnerCertifierInput extends BaseFeatureInput {
  readonly beatpath_matrix: string | number | boolean | readonly string[];
  readonly candidate_ids: string | number | boolean | readonly string[];
  readonly ballot_count: string | number | boolean | readonly string[];
  readonly quorum_rule: string | number | boolean | readonly string[];
}

export interface F307SchulzeCondorcetWinnerCertifierOutput {
  readonly featureId: typeof F307_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F307_OPERATION_CODE;
  readonly resolved_beatpath_matrix: unknown;
  readonly resolved_candidate_ids: unknown;
  readonly resolved_ballot_count: unknown;
  readonly resolved_quorum_rule: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F307_FEATURE_ID>;
}

export type F307SchulzeCondorcetWinnerCertifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F307_FEATURE_ID
>;

export const DEFAULT_F307_CONFIG: F307SchulzeCondorcetWinnerCertifierConfig = {
  featureId: F307_FEATURE_ID,
  stage: F307_STAGE,
  operationCode: F307_OPERATION_CODE,
  contractVersion: F307_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F307SchulzeCondorcetWinnerCertifierValidationError extends Error {
  public readonly featureId = F307_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F307 Validation Error on '${field}']: ${message}`);
    this.name = "F307SchulzeCondorcetWinnerCertifierValidationError";
    this.field = field;
  }
}

export function computeF307Digest(rawPayload: string): string {
  return `f307_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F307SchulzeCondorcetWinnerCertifierService extends KosmoraFeatureAdapterBase<
  typeof F307_FEATURE_ID,
  typeof F307_STAGE,
  typeof F307_OPERATION_CODE,
  F307SchulzeCondorcetWinnerCertifierConfig,
  F307SchulzeCondorcetWinnerCertifierInput,
  F307SchulzeCondorcetWinnerCertifierOutput
> {
  constructor(
    customConfig?: Partial<F307SchulzeCondorcetWinnerCertifierConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F307_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["beatpath_matrix", "candidate_ids", "ballot_count", "quorum_rule"] as const,
      F307SchulzeCondorcetWinnerCertifierValidationError
    );
  }
}

export function verifyF307Module(): {
  readonly featureId: typeof F307_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F307SchulzeCondorcetWinnerCertifierService();
  const sampleInput: F307SchulzeCondorcetWinnerCertifierInput = {
    requestId: "req_verify_f307",
    projectId: "proj_kosmora_f307",
    workspaceId: "ws_kosmora_f307",
    tenantId: "tenant_rlm_f307",
    actorId: "actor_verifier_f307",
    autonomyLevel: "A3",
    beatpath_matrix: "seed_f307_beatpath_matrix",
    candidate_ids: 42,
    ballot_count: true,
    quorum_rule: "seed_f307_quorum_rule",
    metadata: { stage: "stage10-game-theory", featureId: "F307" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F307" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_beatpath_matrix !== sampleInput.beatpath_matrix &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F307] Verification failed`);
  }

  return {
    featureId: F307_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
