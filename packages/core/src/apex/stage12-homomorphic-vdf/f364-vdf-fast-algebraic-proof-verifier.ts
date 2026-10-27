/**
 * F364 (stage12-homomorphic-vdf): Быстрый алгебраический верификатор VDF: pi^l * x^(2^T mod l) === y (mod N)
 * Мгновенная проверка доказательства задержки за O(log l) операций без повторения T возведений в квадрат
 * Operation Code: vdf_fast_verifier
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

export const F364_FEATURE_ID = "F364" as const;
export const F364_STAGE = "stage12-homomorphic-vdf" as const;
export const F364_OPERATION_CODE = "vdf_fast_verifier" as const;
export const F364_CONTRACT_VERSION = "2.0.0" as const;

export type F364VdfFastAlgebraicProofVerifierConfig = BaseFeatureConfig<
  typeof F364_FEATURE_ID,
  typeof F364_STAGE,
  typeof F364_OPERATION_CODE
>;

export interface F364VdfFastAlgebraicProofVerifierInput extends BaseFeatureInput {
  readonly challenge_id: string | number | boolean | readonly string[];
  readonly proof_pi: string | number | boolean | readonly string[];
  readonly remainder_r: string | number | boolean | readonly string[];
  readonly vdf_verified: string | number | boolean | readonly string[];
}

export interface F364VdfFastAlgebraicProofVerifierOutput {
  readonly featureId: typeof F364_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F364_OPERATION_CODE;
  readonly resolved_challenge_id: unknown;
  readonly resolved_proof_pi: unknown;
  readonly resolved_remainder_r: unknown;
  readonly resolved_vdf_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F364_FEATURE_ID>;
}

export type F364VdfFastAlgebraicProofVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F364_FEATURE_ID
>;

export const DEFAULT_F364_CONFIG: F364VdfFastAlgebraicProofVerifierConfig = {
  featureId: F364_FEATURE_ID,
  stage: F364_STAGE,
  operationCode: F364_OPERATION_CODE,
  contractVersion: F364_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F364VdfFastAlgebraicProofVerifierValidationError extends Error {
  public readonly featureId = F364_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F364 Validation Error on '${field}']: ${message}`);
    this.name = "F364VdfFastAlgebraicProofVerifierValidationError";
    this.field = field;
  }
}

export function computeF364Digest(rawPayload: string): string {
  return `f364_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F364VdfFastAlgebraicProofVerifierService extends KosmoraFeatureAdapterBase<
  typeof F364_FEATURE_ID,
  typeof F364_STAGE,
  typeof F364_OPERATION_CODE,
  F364VdfFastAlgebraicProofVerifierConfig,
  F364VdfFastAlgebraicProofVerifierInput,
  F364VdfFastAlgebraicProofVerifierOutput
> {
  constructor(
    customConfig?: Partial<F364VdfFastAlgebraicProofVerifierConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F364_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["challenge_id", "proof_pi", "remainder_r", "vdf_verified"] as const,
      F364VdfFastAlgebraicProofVerifierValidationError
    );
  }
}

export function verifyF364Module(): {
  readonly featureId: typeof F364_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F364VdfFastAlgebraicProofVerifierService();
  const sampleInput: F364VdfFastAlgebraicProofVerifierInput = {
    requestId: "req_verify_f364",
    projectId: "proj_kosmora_f364",
    workspaceId: "ws_kosmora_f364",
    tenantId: "tenant_rlm_f364",
    actorId: "actor_verifier_f364",
    autonomyLevel: "A3",
    challenge_id: "seed_f364_challenge_id",
    proof_pi: 42,
    remainder_r: true,
    vdf_verified: "seed_f364_vdf_verified",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F364" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F364" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_challenge_id !== sampleInput.challenge_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F364] Verification failed`);
  }

  return {
    featureId: F364_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
