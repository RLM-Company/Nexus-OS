/**
 * F356 (stage12-homomorphic-vdf): Гомоморфный умножитель шифротекста на константу E(m)^k mod n^2 = E(k * m)
 * Масштабирование зашифрованных оценок и весов агентов в слепом вычислительном контуре
 * Operation Code: paillier_scalar_mul
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

export const F356_FEATURE_ID = "F356" as const;
export const F356_STAGE = "stage12-homomorphic-vdf" as const;
export const F356_OPERATION_CODE = "paillier_scalar_mul" as const;
export const F356_CONTRACT_VERSION = "2.0.0" as const;

export type F356PaillierHomomorphicScalarMultiplierConfig = BaseFeatureConfig<
  typeof F356_FEATURE_ID,
  typeof F356_STAGE,
  typeof F356_OPERATION_CODE
>;

export interface F356PaillierHomomorphicScalarMultiplierInput extends BaseFeatureInput {
  readonly base_ciphertext: string | number | boolean | readonly string[];
  readonly scalar_factor_k: string | number | boolean | readonly string[];
  readonly scaled_ciphertext: string | number | boolean | readonly string[];
  readonly decrypted_check: string | number | boolean | readonly string[];
}

export interface F356PaillierHomomorphicScalarMultiplierOutput {
  readonly featureId: typeof F356_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F356_OPERATION_CODE;
  readonly resolved_base_ciphertext: unknown;
  readonly resolved_scalar_factor_k: unknown;
  readonly resolved_scaled_ciphertext: unknown;
  readonly resolved_decrypted_check: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F356_FEATURE_ID>;
}

export type F356PaillierHomomorphicScalarMultiplierTelemetrySnapshot = BaseFeatureTelemetry<typeof F356_FEATURE_ID>;

export const DEFAULT_F356_CONFIG: F356PaillierHomomorphicScalarMultiplierConfig = {
  featureId: F356_FEATURE_ID,
  stage: F356_STAGE,
  operationCode: F356_OPERATION_CODE,
  contractVersion: F356_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F356PaillierHomomorphicScalarMultiplierValidationError extends Error {
  public readonly featureId = F356_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F356 Validation Error on '${field}']: ${message}`);
    this.name = "F356PaillierHomomorphicScalarMultiplierValidationError";
    this.field = field;
  }
}

export function computeF356Digest(rawPayload: string): string {
  return `f356_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F356PaillierHomomorphicScalarMultiplierService extends KosmoraFeatureAdapterBase<
  typeof F356_FEATURE_ID,
  typeof F356_STAGE,
  typeof F356_OPERATION_CODE,
  F356PaillierHomomorphicScalarMultiplierConfig,
  F356PaillierHomomorphicScalarMultiplierInput,
  F356PaillierHomomorphicScalarMultiplierOutput
> {
  constructor(customConfig?: Partial<F356PaillierHomomorphicScalarMultiplierConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F356_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["base_ciphertext", "scalar_factor_k", "scaled_ciphertext", "decrypted_check"] as const,
      F356PaillierHomomorphicScalarMultiplierValidationError
    );
  }
}

export function verifyF356Module(): {
  readonly featureId: typeof F356_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F356PaillierHomomorphicScalarMultiplierService();
  const sampleInput: F356PaillierHomomorphicScalarMultiplierInput = {
    requestId: "req_verify_f356",
    projectId: "proj_kosmora_f356",
    workspaceId: "ws_kosmora_f356",
    tenantId: "tenant_rlm_f356",
    actorId: "actor_verifier_f356",
    autonomyLevel: "A3",
    base_ciphertext: "seed_f356_base_ciphertext",
    scalar_factor_k: 42,
    scaled_ciphertext: true,
    decrypted_check: "seed_f356_decrypted_check",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F356" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F356" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_base_ciphertext !== sampleInput.base_ciphertext &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F356] Verification failed`);
  }

  return {
    featureId: F356_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
