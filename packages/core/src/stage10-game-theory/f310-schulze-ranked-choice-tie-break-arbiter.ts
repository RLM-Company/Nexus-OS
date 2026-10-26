/**
 * F310 (stage10-game-theory): Детерминированный арбитр разрешения ничьих в методе Шульце
 * Разрешение симметричных циклов Кондорсе по криптографически фиксированному правилу старшинства
 * Operation Code: schulze_tie_arbiter
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

export const F310_FEATURE_ID = "F310" as const;
export const F310_STAGE = "stage10-game-theory" as const;
export const F310_OPERATION_CODE = "schulze_tie_arbiter" as const;
export const F310_CONTRACT_VERSION = "2.0.0" as const;

export type F310SchulzeRankedChoiceTieBreakArbiterConfig = BaseFeatureConfig<
  typeof F310_FEATURE_ID,
  typeof F310_STAGE,
  typeof F310_OPERATION_CODE
>;

export interface F310SchulzeRankedChoiceTieBreakArbiterInput extends BaseFeatureInput {
  readonly tied_candidate_pair: string | number | boolean | readonly string[];
  readonly beatpath_forward: string | number | boolean | readonly string[];
  readonly beatpath_reverse: string | number | boolean | readonly string[];
  readonly lexicographic_rule: string | number | boolean | readonly string[];
}

export interface F310SchulzeRankedChoiceTieBreakArbiterOutput {
  readonly featureId: typeof F310_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F310_OPERATION_CODE;
  readonly resolved_tied_candidate_pair: unknown;
  readonly resolved_beatpath_forward: unknown;
  readonly resolved_beatpath_reverse: unknown;
  readonly resolved_lexicographic_rule: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F310_FEATURE_ID>;
}

export type F310SchulzeRankedChoiceTieBreakArbiterTelemetrySnapshot = BaseFeatureTelemetry<typeof F310_FEATURE_ID>;

export const DEFAULT_F310_CONFIG: F310SchulzeRankedChoiceTieBreakArbiterConfig = {
  featureId: F310_FEATURE_ID,
  stage: F310_STAGE,
  operationCode: F310_OPERATION_CODE,
  contractVersion: F310_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F310SchulzeRankedChoiceTieBreakArbiterValidationError extends Error {
  public readonly featureId = F310_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F310 Validation Error on '${field}']: ${message}`);
    this.name = "F310SchulzeRankedChoiceTieBreakArbiterValidationError";
    this.field = field;
  }
}

export function computeF310Digest(rawPayload: string): string {
  return `f310_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F310SchulzeRankedChoiceTieBreakArbiterService extends KosmoraFeatureAdapterBase<
  typeof F310_FEATURE_ID,
  typeof F310_STAGE,
  typeof F310_OPERATION_CODE,
  F310SchulzeRankedChoiceTieBreakArbiterConfig,
  F310SchulzeRankedChoiceTieBreakArbiterInput,
  F310SchulzeRankedChoiceTieBreakArbiterOutput
> {
  constructor(customConfig?: Partial<F310SchulzeRankedChoiceTieBreakArbiterConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F310_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["tied_candidate_pair", "beatpath_forward", "beatpath_reverse", "lexicographic_rule"] as const,
      F310SchulzeRankedChoiceTieBreakArbiterValidationError
    );
  }
}

export function verifyF310Module(): {
  readonly featureId: typeof F310_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F310SchulzeRankedChoiceTieBreakArbiterService();
  const sampleInput: F310SchulzeRankedChoiceTieBreakArbiterInput = {
    requestId: "req_verify_f310",
    projectId: "proj_kosmora_f310",
    workspaceId: "ws_kosmora_f310",
    tenantId: "tenant_rlm_f310",
    actorId: "actor_verifier_f310",
    autonomyLevel: "A3",
    tied_candidate_pair: "seed_f310_tied_candidate_pair",
    beatpath_forward: 42,
    beatpath_reverse: true,
    lexicographic_rule: "seed_f310_lexicographic_rule",
    metadata: { stage: "stage10-game-theory", featureId: "F310" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F310" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tied_candidate_pair !== sampleInput.tied_candidate_pair &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F310] Verification failed`);
  }

  return {
    featureId: F310_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
