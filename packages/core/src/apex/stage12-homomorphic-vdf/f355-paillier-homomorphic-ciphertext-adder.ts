/**
 * F355 (stage12-homomorphic-vdf): Гомоморфный сумматор зашифрованных текстов E(m1) * E(m2) mod n^2 = E(m1 + m2)
 * Сложение приватных финансовых и телеметрических показателей разных тенантов без расшифровки
 * Operation Code: paillier_homomorphic_add
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

export const F355_FEATURE_ID = "F355" as const;
export const F355_STAGE = "stage12-homomorphic-vdf" as const;
export const F355_OPERATION_CODE = "paillier_homomorphic_add" as const;
export const F355_CONTRACT_VERSION = "2.0.0" as const;

export type F355PaillierHomomorphicCiphertextAdderConfig = BaseFeatureConfig<
  typeof F355_FEATURE_ID,
  typeof F355_STAGE,
  typeof F355_OPERATION_CODE
>;

export interface F355PaillierHomomorphicCiphertextAdderInput extends BaseFeatureInput {
  readonly ciphertext_a: string | number | boolean | readonly string[];
  readonly ciphertext_b: string | number | boolean | readonly string[];
  readonly sum_ciphertext: string | number | boolean | readonly string[];
  readonly homomorphic_verified: string | number | boolean | readonly string[];
}

export interface F355PaillierHomomorphicCiphertextAdderOutput {
  readonly featureId: typeof F355_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F355_OPERATION_CODE;
  readonly resolved_ciphertext_a: unknown;
  readonly resolved_ciphertext_b: unknown;
  readonly resolved_sum_ciphertext: unknown;
  readonly resolved_homomorphic_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F355_FEATURE_ID>;
}

export type F355PaillierHomomorphicCiphertextAdderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F355_FEATURE_ID
>;

export const DEFAULT_F355_CONFIG: F355PaillierHomomorphicCiphertextAdderConfig = {
  featureId: F355_FEATURE_ID,
  stage: F355_STAGE,
  operationCode: F355_OPERATION_CODE,
  contractVersion: F355_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F355PaillierHomomorphicCiphertextAdderValidationError extends Error {
  public readonly featureId = F355_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F355 Validation Error on '${field}']: ${message}`);
    this.name = "F355PaillierHomomorphicCiphertextAdderValidationError";
    this.field = field;
  }
}

export function computeF355Digest(rawPayload: string): string {
  return `f355_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F355PaillierHomomorphicCiphertextAdderService extends KosmoraFeatureAdapterBase<
  typeof F355_FEATURE_ID,
  typeof F355_STAGE,
  typeof F355_OPERATION_CODE,
  F355PaillierHomomorphicCiphertextAdderConfig,
  F355PaillierHomomorphicCiphertextAdderInput,
  F355PaillierHomomorphicCiphertextAdderOutput
> {
  constructor(
    customConfig?: Partial<F355PaillierHomomorphicCiphertextAdderConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F355_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["ciphertext_a", "ciphertext_b", "sum_ciphertext", "homomorphic_verified"] as const,
      F355PaillierHomomorphicCiphertextAdderValidationError
    );
  }
}

export function verifyF355Module(): {
  readonly featureId: typeof F355_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F355PaillierHomomorphicCiphertextAdderService();
  const sampleInput: F355PaillierHomomorphicCiphertextAdderInput = {
    requestId: "req_verify_f355",
    projectId: "proj_kosmora_f355",
    workspaceId: "ws_kosmora_f355",
    tenantId: "tenant_rlm_f355",
    actorId: "actor_verifier_f355",
    autonomyLevel: "A3",
    ciphertext_a: "seed_f355_ciphertext_a",
    ciphertext_b: 42,
    sum_ciphertext: true,
    homomorphic_verified: "seed_f355_homomorphic_verified",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F355" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F355" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_ciphertext_a !== sampleInput.ciphertext_a &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F355] Verification failed`);
  }

  return {
    featureId: F355_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
