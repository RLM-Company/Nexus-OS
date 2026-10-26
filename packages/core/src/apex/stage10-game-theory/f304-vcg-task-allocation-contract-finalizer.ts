/**
 * F304 (stage10-game-theory): Финализатор смарт-контрактов распределения задач по итогам VCG
 * Закрепление выбранных исполнителей и гарантированных выплат в плане исполнения DAG
 * Operation Code: vcg_contract_finalize
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

export const F304_FEATURE_ID = "F304" as const;
export const F304_STAGE = "stage10-game-theory" as const;
export const F304_OPERATION_CODE = "vcg_contract_finalize" as const;
export const F304_CONTRACT_VERSION = "2.0.0" as const;

export type F304VcgTaskAllocationContractFinalizerConfig = BaseFeatureConfig<
  typeof F304_FEATURE_ID,
  typeof F304_STAGE,
  typeof F304_OPERATION_CODE
>;

export interface F304VcgTaskAllocationContractFinalizerInput extends BaseFeatureInput {
  readonly auction_id: string | number | boolean | readonly string[];
  readonly winner_schedule: string | number | boolean | readonly string[];
  readonly vcg_payment_vector: string | number | boolean | readonly string[];
  readonly escrow_lock_id: string | number | boolean | readonly string[];
}

export interface F304VcgTaskAllocationContractFinalizerOutput {
  readonly featureId: typeof F304_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F304_OPERATION_CODE;
  readonly resolved_auction_id: unknown;
  readonly resolved_winner_schedule: unknown;
  readonly resolved_vcg_payment_vector: unknown;
  readonly resolved_escrow_lock_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F304_FEATURE_ID>;
}

export type F304VcgTaskAllocationContractFinalizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F304_FEATURE_ID
>;

export const DEFAULT_F304_CONFIG: F304VcgTaskAllocationContractFinalizerConfig = {
  featureId: F304_FEATURE_ID,
  stage: F304_STAGE,
  operationCode: F304_OPERATION_CODE,
  contractVersion: F304_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F304VcgTaskAllocationContractFinalizerValidationError extends Error {
  public readonly featureId = F304_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F304 Validation Error on '${field}']: ${message}`);
    this.name = "F304VcgTaskAllocationContractFinalizerValidationError";
    this.field = field;
  }
}

export function computeF304Digest(rawPayload: string): string {
  return `f304_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F304VcgTaskAllocationContractFinalizerService extends KosmoraFeatureAdapterBase<
  typeof F304_FEATURE_ID,
  typeof F304_STAGE,
  typeof F304_OPERATION_CODE,
  F304VcgTaskAllocationContractFinalizerConfig,
  F304VcgTaskAllocationContractFinalizerInput,
  F304VcgTaskAllocationContractFinalizerOutput
> {
  constructor(
    customConfig?: Partial<F304VcgTaskAllocationContractFinalizerConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F304_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["auction_id", "winner_schedule", "vcg_payment_vector", "escrow_lock_id"] as const,
      F304VcgTaskAllocationContractFinalizerValidationError
    );
  }
}

export function verifyF304Module(): {
  readonly featureId: typeof F304_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F304VcgTaskAllocationContractFinalizerService();
  const sampleInput: F304VcgTaskAllocationContractFinalizerInput = {
    requestId: "req_verify_f304",
    projectId: "proj_kosmora_f304",
    workspaceId: "ws_kosmora_f304",
    tenantId: "tenant_rlm_f304",
    actorId: "actor_verifier_f304",
    autonomyLevel: "A3",
    auction_id: "seed_f304_auction_id",
    winner_schedule: 42,
    vcg_payment_vector: true,
    escrow_lock_id: "seed_f304_escrow_lock_id",
    metadata: { stage: "stage10-game-theory", featureId: "F304" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F304" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_auction_id !== sampleInput.auction_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F304] Verification failed`);
  }

  return {
    featureId: F304_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
