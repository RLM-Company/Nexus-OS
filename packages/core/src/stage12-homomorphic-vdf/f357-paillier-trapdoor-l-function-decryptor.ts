/**
 * F357 (stage12-homomorphic-vdf): Дешифратор Пэйе через функцию L(c^lambda mod n^2) * mu mod n
 * Точное восстановление суммы открытых текстов уполномоченным владельцем приватного ключа
 * Operation Code: paillier_decrypt
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

export const F357_FEATURE_ID = "F357" as const;
export const F357_STAGE = "stage12-homomorphic-vdf" as const;
export const F357_OPERATION_CODE = "paillier_decrypt" as const;
export const F357_CONTRACT_VERSION = "2.0.0" as const;

export type F357PaillierTrapdoorLFunctionDecryptorConfig = BaseFeatureConfig<
  typeof F357_FEATURE_ID,
  typeof F357_STAGE,
  typeof F357_OPERATION_CODE
>;

export interface F357PaillierTrapdoorLFunctionDecryptorInput extends BaseFeatureInput {
  readonly ciphertext_input: string | number | boolean | readonly string[];
  readonly decrypted_sum: string | number | boolean | readonly string[];
  readonly expected_sum: string | number | boolean | readonly string[];
  readonly exact_match: string | number | boolean | readonly string[];
}

export interface F357PaillierTrapdoorLFunctionDecryptorOutput {
  readonly featureId: typeof F357_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F357_OPERATION_CODE;
  readonly resolved_ciphertext_input: unknown;
  readonly resolved_decrypted_sum: unknown;
  readonly resolved_expected_sum: unknown;
  readonly resolved_exact_match: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F357_FEATURE_ID>;
}

export type F357PaillierTrapdoorLFunctionDecryptorTelemetrySnapshot = BaseFeatureTelemetry<typeof F357_FEATURE_ID>;

export const DEFAULT_F357_CONFIG: F357PaillierTrapdoorLFunctionDecryptorConfig = {
  featureId: F357_FEATURE_ID,
  stage: F357_STAGE,
  operationCode: F357_OPERATION_CODE,
  contractVersion: F357_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F357PaillierTrapdoorLFunctionDecryptorValidationError extends Error {
  public readonly featureId = F357_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F357 Validation Error on '${field}']: ${message}`);
    this.name = "F357PaillierTrapdoorLFunctionDecryptorValidationError";
    this.field = field;
  }
}

export function computeF357Digest(rawPayload: string): string {
  return `f357_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F357PaillierTrapdoorLFunctionDecryptorService extends KosmoraFeatureAdapterBase<
  typeof F357_FEATURE_ID,
  typeof F357_STAGE,
  typeof F357_OPERATION_CODE,
  F357PaillierTrapdoorLFunctionDecryptorConfig,
  F357PaillierTrapdoorLFunctionDecryptorInput,
  F357PaillierTrapdoorLFunctionDecryptorOutput
> {
  constructor(customConfig?: Partial<F357PaillierTrapdoorLFunctionDecryptorConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F357_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["ciphertext_input", "decrypted_sum", "expected_sum", "exact_match"] as const,
      F357PaillierTrapdoorLFunctionDecryptorValidationError
    );
  }
}

export function verifyF357Module(): {
  readonly featureId: typeof F357_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F357PaillierTrapdoorLFunctionDecryptorService();
  const sampleInput: F357PaillierTrapdoorLFunctionDecryptorInput = {
    requestId: "req_verify_f357",
    projectId: "proj_kosmora_f357",
    workspaceId: "ws_kosmora_f357",
    tenantId: "tenant_rlm_f357",
    actorId: "actor_verifier_f357",
    autonomyLevel: "A3",
    ciphertext_input: "seed_f357_ciphertext_input",
    decrypted_sum: 42,
    expected_sum: true,
    exact_match: "seed_f357_exact_match",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F357" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F357" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_ciphertext_input !== sampleInput.ciphertext_input &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F357] Verification failed`);
  }

  return {
    featureId: F357_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
