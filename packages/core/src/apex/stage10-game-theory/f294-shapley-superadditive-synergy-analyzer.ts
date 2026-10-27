/**
 * F294 (stage10-game-theory): Анализатор супераддитивной синергии коалиций (v(A U B) >= v(A) + v(B))
 * Измерение чистого кооперативного выигрыша от совместной работы специализированных агентов
 * Operation Code: shapley_synergy_analyze
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

export const F294_FEATURE_ID = "F294" as const;
export const F294_STAGE = "stage10-game-theory" as const;
export const F294_OPERATION_CODE = "shapley_synergy_analyze" as const;
export const F294_CONTRACT_VERSION = "2.0.0" as const;

export type F294ShapleySuperadditiveSynergyAnalyzerConfig = BaseFeatureConfig<
  typeof F294_FEATURE_ID,
  typeof F294_STAGE,
  typeof F294_OPERATION_CODE
>;

export interface F294ShapleySuperadditiveSynergyAnalyzerInput extends BaseFeatureInput {
  readonly singleton_sum: string | number | boolean | readonly string[];
  readonly grand_coalition_worth: string | number | boolean | readonly string[];
  readonly synergy_bonus_pool: string | number | boolean | readonly string[];
  readonly distribution_rule: string | number | boolean | readonly string[];
}

export interface F294ShapleySuperadditiveSynergyAnalyzerOutput {
  readonly featureId: typeof F294_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F294_OPERATION_CODE;
  readonly resolved_singleton_sum: unknown;
  readonly resolved_grand_coalition_worth: unknown;
  readonly resolved_synergy_bonus_pool: unknown;
  readonly resolved_distribution_rule: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F294_FEATURE_ID>;
}

export type F294ShapleySuperadditiveSynergyAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F294_FEATURE_ID
>;

export const DEFAULT_F294_CONFIG: F294ShapleySuperadditiveSynergyAnalyzerConfig = {
  featureId: F294_FEATURE_ID,
  stage: F294_STAGE,
  operationCode: F294_OPERATION_CODE,
  contractVersion: F294_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F294ShapleySuperadditiveSynergyAnalyzerValidationError extends Error {
  public readonly featureId = F294_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F294 Validation Error on '${field}']: ${message}`);
    this.name = "F294ShapleySuperadditiveSynergyAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF294Digest(rawPayload: string): string {
  return `f294_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F294ShapleySuperadditiveSynergyAnalyzerService extends KosmoraFeatureAdapterBase<
  typeof F294_FEATURE_ID,
  typeof F294_STAGE,
  typeof F294_OPERATION_CODE,
  F294ShapleySuperadditiveSynergyAnalyzerConfig,
  F294ShapleySuperadditiveSynergyAnalyzerInput,
  F294ShapleySuperadditiveSynergyAnalyzerOutput
> {
  constructor(
    customConfig?: Partial<F294ShapleySuperadditiveSynergyAnalyzerConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F294_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      [
        "singleton_sum",
        "grand_coalition_worth",
        "synergy_bonus_pool",
        "distribution_rule"
      ] as const,
      F294ShapleySuperadditiveSynergyAnalyzerValidationError
    );
  }
}

export function verifyF294Module(): {
  readonly featureId: typeof F294_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F294ShapleySuperadditiveSynergyAnalyzerService();
  const sampleInput: F294ShapleySuperadditiveSynergyAnalyzerInput = {
    requestId: "req_verify_f294",
    projectId: "proj_kosmora_f294",
    workspaceId: "ws_kosmora_f294",
    tenantId: "tenant_rlm_f294",
    actorId: "actor_verifier_f294",
    autonomyLevel: "A3",
    singleton_sum: "seed_f294_singleton_sum",
    grand_coalition_worth: 42,
    synergy_bonus_pool: true,
    distribution_rule: "seed_f294_distribution_rule",
    metadata: { stage: "stage10-game-theory", featureId: "F294" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F294" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_singleton_sum !== sampleInput.singleton_sum &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F294] Verification failed`);
  }

  return {
    featureId: F294_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
