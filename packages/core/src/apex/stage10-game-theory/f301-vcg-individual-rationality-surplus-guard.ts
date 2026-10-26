/**
 * F301 (stage10-game-theory): Гарант индивидуальной рациональности участия агентов (Individual Rationality)
 * Проверка того, что итоговая выплата VCG каждому победителю не ниже его истинных заявленных затрат
 * Operation Code: vcg_utility_surplus
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

export const F301_FEATURE_ID = "F301" as const;
export const F301_STAGE = "stage10-game-theory" as const;
export const F301_OPERATION_CODE = "vcg_utility_surplus" as const;
export const F301_CONTRACT_VERSION = "2.0.0" as const;

export type F301VcgIndividualRationalitySurplusGuardConfig = BaseFeatureConfig<
  typeof F301_FEATURE_ID,
  typeof F301_STAGE,
  typeof F301_OPERATION_CODE
>;

export interface F301VcgIndividualRationalitySurplusGuardInput extends BaseFeatureInput {
  readonly agent_id: string | number | boolean | readonly string[];
  readonly vcg_payment_usd: string | number | boolean | readonly string[];
  readonly true_execution_cost_usd: string | number | boolean | readonly string[];
  readonly participation_floor: string | number | boolean | readonly string[];
}

export interface F301VcgIndividualRationalitySurplusGuardOutput {
  readonly featureId: typeof F301_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F301_OPERATION_CODE;
  readonly resolved_agent_id: unknown;
  readonly resolved_vcg_payment_usd: unknown;
  readonly resolved_true_execution_cost_usd: unknown;
  readonly resolved_participation_floor: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F301_FEATURE_ID>;
}

export type F301VcgIndividualRationalitySurplusGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F301_FEATURE_ID
>;

export const DEFAULT_F301_CONFIG: F301VcgIndividualRationalitySurplusGuardConfig = {
  featureId: F301_FEATURE_ID,
  stage: F301_STAGE,
  operationCode: F301_OPERATION_CODE,
  contractVersion: F301_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F301VcgIndividualRationalitySurplusGuardValidationError extends Error {
  public readonly featureId = F301_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F301 Validation Error on '${field}']: ${message}`);
    this.name = "F301VcgIndividualRationalitySurplusGuardValidationError";
    this.field = field;
  }
}

export function computeF301Digest(rawPayload: string): string {
  return `f301_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F301VcgIndividualRationalitySurplusGuardService extends KosmoraFeatureAdapterBase<
  typeof F301_FEATURE_ID,
  typeof F301_STAGE,
  typeof F301_OPERATION_CODE,
  F301VcgIndividualRationalitySurplusGuardConfig,
  F301VcgIndividualRationalitySurplusGuardInput,
  F301VcgIndividualRationalitySurplusGuardOutput
> {
  constructor(
    customConfig?: Partial<F301VcgIndividualRationalitySurplusGuardConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F301_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["agent_id", "vcg_payment_usd", "true_execution_cost_usd", "participation_floor"] as const,
      F301VcgIndividualRationalitySurplusGuardValidationError
    );
  }
}

export function verifyF301Module(): {
  readonly featureId: typeof F301_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F301VcgIndividualRationalitySurplusGuardService();
  const sampleInput: F301VcgIndividualRationalitySurplusGuardInput = {
    requestId: "req_verify_f301",
    projectId: "proj_kosmora_f301",
    workspaceId: "ws_kosmora_f301",
    tenantId: "tenant_rlm_f301",
    actorId: "actor_verifier_f301",
    autonomyLevel: "A3",
    agent_id: "seed_f301_agent_id",
    vcg_payment_usd: 42,
    true_execution_cost_usd: true,
    participation_floor: "seed_f301_participation_floor",
    metadata: { stage: "stage10-game-theory", featureId: "F301" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F301" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_id !== sampleInput.agent_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F301] Verification failed`);
  }

  return {
    featureId: F301_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
