/**
 * F363 (stage12-homomorphic-vdf): Синтезатор компактного доказательства Весоловского pi = x^(floor(2^T / l)) mod N
 * Построение краткого криптографического свидетельства выполненной временной работы
 * Operation Code: vdf_wesolowski_prover
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

export const F363_FEATURE_ID = "F363" as const;
export const F363_STAGE = "stage12-homomorphic-vdf" as const;
export const F363_OPERATION_CODE = "vdf_wesolowski_prover" as const;
export const F363_CONTRACT_VERSION = "2.0.0" as const;

export type F363VdfWesolowskiQuotientProofSynthesizerConfig = BaseFeatureConfig<
  typeof F363_FEATURE_ID,
  typeof F363_STAGE,
  typeof F363_OPERATION_CODE
>;

export interface F363VdfWesolowskiQuotientProofSynthesizerInput extends BaseFeatureInput {
  readonly challenge_id: string | number | boolean | readonly string[];
  readonly prime_l: string | number | boolean | readonly string[];
  readonly wesolowski_pi: string | number | boolean | readonly string[];
  readonly proof_ready: string | number | boolean | readonly string[];
}

export interface F363VdfWesolowskiQuotientProofSynthesizerOutput {
  readonly featureId: typeof F363_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F363_OPERATION_CODE;
  readonly resolved_challenge_id: unknown;
  readonly resolved_prime_l: unknown;
  readonly resolved_wesolowski_pi: unknown;
  readonly resolved_proof_ready: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F363_FEATURE_ID>;
}

export type F363VdfWesolowskiQuotientProofSynthesizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F363_FEATURE_ID
>;

export const DEFAULT_F363_CONFIG: F363VdfWesolowskiQuotientProofSynthesizerConfig = {
  featureId: F363_FEATURE_ID,
  stage: F363_STAGE,
  operationCode: F363_OPERATION_CODE,
  contractVersion: F363_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F363VdfWesolowskiQuotientProofSynthesizerValidationError extends Error {
  public readonly featureId = F363_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F363 Validation Error on '${field}']: ${message}`);
    this.name = "F363VdfWesolowskiQuotientProofSynthesizerValidationError";
    this.field = field;
  }
}

export function computeF363Digest(rawPayload: string): string {
  return `f363_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F363VdfWesolowskiQuotientProofSynthesizerService extends KosmoraFeatureAdapterBase<
  typeof F363_FEATURE_ID,
  typeof F363_STAGE,
  typeof F363_OPERATION_CODE,
  F363VdfWesolowskiQuotientProofSynthesizerConfig,
  F363VdfWesolowskiQuotientProofSynthesizerInput,
  F363VdfWesolowskiQuotientProofSynthesizerOutput
> {
  constructor(
    customConfig?: Partial<F363VdfWesolowskiQuotientProofSynthesizerConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F363_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["challenge_id", "prime_l", "wesolowski_pi", "proof_ready"] as const,
      F363VdfWesolowskiQuotientProofSynthesizerValidationError
    );
  }
}

export function verifyF363Module(): {
  readonly featureId: typeof F363_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F363VdfWesolowskiQuotientProofSynthesizerService();
  const sampleInput: F363VdfWesolowskiQuotientProofSynthesizerInput = {
    requestId: "req_verify_f363",
    projectId: "proj_kosmora_f363",
    workspaceId: "ws_kosmora_f363",
    tenantId: "tenant_rlm_f363",
    actorId: "actor_verifier_f363",
    autonomyLevel: "A3",
    challenge_id: "seed_f363_challenge_id",
    prime_l: 42,
    wesolowski_pi: true,
    proof_ready: "seed_f363_proof_ready",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F363" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F363" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_challenge_id !== sampleInput.challenge_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F363] Verification failed`);
  }

  return {
    featureId: F363_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
