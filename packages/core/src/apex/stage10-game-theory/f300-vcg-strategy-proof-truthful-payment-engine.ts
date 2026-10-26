/**
 * F300 (stage10-game-theory): Движок неманипулируемых выплат VCG (Strategy-Proof Payment Engine)
 * Формирование выплат победителям, при которых сообщение истинных издержек является доминирующей стратегией
 * Operation Code: vcg_truthful_payment
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

export const F300_FEATURE_ID = "F300" as const;
export const F300_STAGE = "stage10-game-theory" as const;
export const F300_OPERATION_CODE = "vcg_truthful_payment" as const;
export const F300_CONTRACT_VERSION = "2.0.0" as const;

export type F300VcgStrategyProofTruthfulPaymentEngineConfig = BaseFeatureConfig<
  typeof F300_FEATURE_ID,
  typeof F300_STAGE,
  typeof F300_OPERATION_CODE
>;

export interface F300VcgStrategyProofTruthfulPaymentEngineInput extends BaseFeatureInput {
  readonly winning_assignments: string | number | boolean | readonly string[];
  readonly reported_bids: string | number | boolean | readonly string[];
  readonly clarke_externality: string | number | boolean | readonly string[];
  readonly payment_cap_usd: string | number | boolean | readonly string[];
}

export interface F300VcgStrategyProofTruthfulPaymentEngineOutput {
  readonly featureId: typeof F300_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F300_OPERATION_CODE;
  readonly resolved_winning_assignments: unknown;
  readonly resolved_reported_bids: unknown;
  readonly resolved_clarke_externality: unknown;
  readonly resolved_payment_cap_usd: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F300_FEATURE_ID>;
}

export type F300VcgStrategyProofTruthfulPaymentEngineTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F300_FEATURE_ID
>;

export const DEFAULT_F300_CONFIG: F300VcgStrategyProofTruthfulPaymentEngineConfig = {
  featureId: F300_FEATURE_ID,
  stage: F300_STAGE,
  operationCode: F300_OPERATION_CODE,
  contractVersion: F300_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F300VcgStrategyProofTruthfulPaymentEngineValidationError extends Error {
  public readonly featureId = F300_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F300 Validation Error on '${field}']: ${message}`);
    this.name = "F300VcgStrategyProofTruthfulPaymentEngineValidationError";
    this.field = field;
  }
}

export function computeF300Digest(rawPayload: string): string {
  return `f300_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F300VcgStrategyProofTruthfulPaymentEngineService extends KosmoraFeatureAdapterBase<
  typeof F300_FEATURE_ID,
  typeof F300_STAGE,
  typeof F300_OPERATION_CODE,
  F300VcgStrategyProofTruthfulPaymentEngineConfig,
  F300VcgStrategyProofTruthfulPaymentEngineInput,
  F300VcgStrategyProofTruthfulPaymentEngineOutput
> {
  constructor(
    customConfig?: Partial<F300VcgStrategyProofTruthfulPaymentEngineConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F300_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["winning_assignments", "reported_bids", "clarke_externality", "payment_cap_usd"] as const,
      F300VcgStrategyProofTruthfulPaymentEngineValidationError
    );
  }
}

export function verifyF300Module(): {
  readonly featureId: typeof F300_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F300VcgStrategyProofTruthfulPaymentEngineService();
  const sampleInput: F300VcgStrategyProofTruthfulPaymentEngineInput = {
    requestId: "req_verify_f300",
    projectId: "proj_kosmora_f300",
    workspaceId: "ws_kosmora_f300",
    tenantId: "tenant_rlm_f300",
    actorId: "actor_verifier_f300",
    autonomyLevel: "A3",
    winning_assignments: "seed_f300_winning_assignments",
    reported_bids: 42,
    clarke_externality: true,
    payment_cap_usd: "seed_f300_payment_cap_usd",
    metadata: { stage: "stage10-game-theory", featureId: "F300" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F300" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_winning_assignments !== sampleInput.winning_assignments &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F300] Verification failed`);
  }

  return {
    featureId: F300_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
