/**
 * F309 (stage10-game-theory): Фильтр валидности ранжированных бюллетеней при византийском голосовании
 * Проверка полноты и отсутствия циклов внутри индивидуальных ранжировок агентов-верификаторов
 * Operation Code: schulze_ballot_filter
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

export const F309_FEATURE_ID = "F309" as const;
export const F309_STAGE = "stage10-game-theory" as const;
export const F309_OPERATION_CODE = "schulze_ballot_filter" as const;
export const F309_CONTRACT_VERSION = "2.0.0" as const;

export type F309SchulzeByzantineBallotValidityFilterConfig = BaseFeatureConfig<
  typeof F309_FEATURE_ID,
  typeof F309_STAGE,
  typeof F309_OPERATION_CODE
>;

export interface F309SchulzeByzantineBallotValidityFilterInput extends BaseFeatureInput {
  readonly raw_ballots: string | number | boolean | readonly string[];
  readonly authorized_voters: string | number | boolean | readonly string[];
  readonly duplicate_policy: string | number | boolean | readonly string[];
  readonly completeness_rule: string | number | boolean | readonly string[];
}

export interface F309SchulzeByzantineBallotValidityFilterOutput {
  readonly featureId: typeof F309_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F309_OPERATION_CODE;
  readonly resolved_raw_ballots: unknown;
  readonly resolved_authorized_voters: unknown;
  readonly resolved_duplicate_policy: unknown;
  readonly resolved_completeness_rule: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F309_FEATURE_ID>;
}

export type F309SchulzeByzantineBallotValidityFilterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F309_FEATURE_ID
>;

export const DEFAULT_F309_CONFIG: F309SchulzeByzantineBallotValidityFilterConfig = {
  featureId: F309_FEATURE_ID,
  stage: F309_STAGE,
  operationCode: F309_OPERATION_CODE,
  contractVersion: F309_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F309SchulzeByzantineBallotValidityFilterValidationError extends Error {
  public readonly featureId = F309_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F309 Validation Error on '${field}']: ${message}`);
    this.name = "F309SchulzeByzantineBallotValidityFilterValidationError";
    this.field = field;
  }
}

export function computeF309Digest(rawPayload: string): string {
  return `f309_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F309SchulzeByzantineBallotValidityFilterService extends KosmoraFeatureAdapterBase<
  typeof F309_FEATURE_ID,
  typeof F309_STAGE,
  typeof F309_OPERATION_CODE,
  F309SchulzeByzantineBallotValidityFilterConfig,
  F309SchulzeByzantineBallotValidityFilterInput,
  F309SchulzeByzantineBallotValidityFilterOutput
> {
  constructor(
    customConfig?: Partial<F309SchulzeByzantineBallotValidityFilterConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F309_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["raw_ballots", "authorized_voters", "duplicate_policy", "completeness_rule"] as const,
      F309SchulzeByzantineBallotValidityFilterValidationError
    );
  }
}

export function verifyF309Module(): {
  readonly featureId: typeof F309_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F309SchulzeByzantineBallotValidityFilterService();
  const sampleInput: F309SchulzeByzantineBallotValidityFilterInput = {
    requestId: "req_verify_f309",
    projectId: "proj_kosmora_f309",
    workspaceId: "ws_kosmora_f309",
    tenantId: "tenant_rlm_f309",
    actorId: "actor_verifier_f309",
    autonomyLevel: "A3",
    raw_ballots: "seed_f309_raw_ballots",
    authorized_voters: 42,
    duplicate_policy: true,
    completeness_rule: "seed_f309_completeness_rule",
    metadata: { stage: "stage10-game-theory", featureId: "F309" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F309" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_raw_ballots !== sampleInput.raw_ballots &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F309] Verification failed`);
  }

  return {
    featureId: F309_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
