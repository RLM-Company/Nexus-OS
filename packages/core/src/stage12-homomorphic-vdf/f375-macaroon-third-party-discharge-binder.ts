/**
 * F375 (stage12-homomorphic-vdf): Связыватель макарунов с подтверждениями третьей стороны (Third-Party Caveat Discharge)
 * Требование сопутствующего криптографического подтверждения от контура MFA или HITL
 * Operation Code: macaroon_discharge_binder
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
import { Stage12HomomorphicVdfKernel } from "./stage-kernel.js";

export const F375_FEATURE_ID = "F375" as const;
export const F375_STAGE = "stage12-homomorphic-vdf" as const;
export const F375_OPERATION_CODE = "macaroon_discharge_binder" as const;
export const F375_CONTRACT_VERSION = "2.0.0" as const;

export type F375MacaroonThirdPartyDischargeBinderConfig = BaseFeatureConfig<
  typeof F375_FEATURE_ID,
  typeof F375_STAGE,
  typeof F375_OPERATION_CODE
>;

export interface F375MacaroonThirdPartyDischargeBinderInput extends BaseFeatureInput {
  readonly primary_macaroon_id: string | number | boolean | readonly string[];
  readonly discharge_proof_id: string | number | boolean | readonly string[];
  readonly bound_signature: string | number | boolean | readonly string[];
  readonly authorized: string | number | boolean | readonly string[];
}

export interface F375MacaroonThirdPartyDischargeBinderOutput {
  readonly featureId: typeof F375_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F375_OPERATION_CODE;
  readonly resolved_primary_macaroon_id: unknown;
  readonly resolved_discharge_proof_id: unknown;
  readonly resolved_bound_signature: unknown;
  readonly resolved_authorized: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F375_FEATURE_ID>;
}

export type F375MacaroonThirdPartyDischargeBinderTelemetrySnapshot = BaseFeatureTelemetry<typeof F375_FEATURE_ID>;

export const DEFAULT_F375_CONFIG: F375MacaroonThirdPartyDischargeBinderConfig = {
  featureId: F375_FEATURE_ID,
  stage: F375_STAGE,
  operationCode: F375_OPERATION_CODE,
  contractVersion: F375_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F375MacaroonThirdPartyDischargeBinderValidationError extends Error {
  public readonly featureId = F375_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F375 Validation Error on '${field}']: ${message}`);
    this.name = "F375MacaroonThirdPartyDischargeBinderValidationError";
    this.field = field;
  }
}

export function computeF375Digest(rawPayload: string): string {
  return `f375_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F375MacaroonThirdPartyDischargeBinderService extends KosmoraFeatureAdapterBase<
  typeof F375_FEATURE_ID,
  typeof F375_STAGE,
  typeof F375_OPERATION_CODE,
  F375MacaroonThirdPartyDischargeBinderConfig,
  F375MacaroonThirdPartyDischargeBinderInput,
  F375MacaroonThirdPartyDischargeBinderOutput
> {
  constructor(customConfig?: Partial<F375MacaroonThirdPartyDischargeBinderConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F375_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["primary_macaroon_id", "discharge_proof_id", "bound_signature", "authorized"] as const,
      F375MacaroonThirdPartyDischargeBinderValidationError
    );
  }
}

export function verifyF375Module(): {
  readonly featureId: typeof F375_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F375MacaroonThirdPartyDischargeBinderService();
  const sampleInput: F375MacaroonThirdPartyDischargeBinderInput = {
    requestId: "req_verify_f375",
    projectId: "proj_kosmora_f375",
    workspaceId: "ws_kosmora_f375",
    tenantId: "tenant_rlm_f375",
    actorId: "actor_verifier_f375",
    autonomyLevel: "A3",
    primary_macaroon_id: "seed_f375_primary_macaroon_id",
    discharge_proof_id: 42,
    bound_signature: true,
    authorized: "seed_f375_authorized",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F375" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F375" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_primary_macaroon_id !== sampleInput.primary_macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F375] Verification failed`);
  }

  return {
    featureId: F375_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
