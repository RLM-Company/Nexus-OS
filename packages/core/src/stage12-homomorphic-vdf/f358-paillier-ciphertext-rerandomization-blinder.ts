/**
 * F358 (stage12-homomorphic-vdf): Модуль повторного ослепления шифротекстов c' = c * r^n mod n^2 без изменения открытого текста
 * Защита от корреляции шифротекстов при передаче между узлами конвейера
 * Operation Code: paillier_rerandomize
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

export const F358_FEATURE_ID = "F358" as const;
export const F358_STAGE = "stage12-homomorphic-vdf" as const;
export const F358_OPERATION_CODE = "paillier_rerandomize" as const;
export const F358_CONTRACT_VERSION = "2.0.0" as const;

export type F358PaillierCiphertextRerandomizationBlinderConfig = BaseFeatureConfig<
  typeof F358_FEATURE_ID,
  typeof F358_STAGE,
  typeof F358_OPERATION_CODE
>;

export interface F358PaillierCiphertextRerandomizationBlinderInput extends BaseFeatureInput {
  readonly original_cipher: string | number | boolean | readonly string[];
  readonly rerandomized_cipher: string | number | boolean | readonly string[];
  readonly same_plaintext: string | number | boolean | readonly string[];
  readonly unlinkable_ok: string | number | boolean | readonly string[];
}

export interface F358PaillierCiphertextRerandomizationBlinderOutput {
  readonly featureId: typeof F358_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F358_OPERATION_CODE;
  readonly resolved_original_cipher: unknown;
  readonly resolved_rerandomized_cipher: unknown;
  readonly resolved_same_plaintext: unknown;
  readonly resolved_unlinkable_ok: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F358_FEATURE_ID>;
}

export type F358PaillierCiphertextRerandomizationBlinderTelemetrySnapshot = BaseFeatureTelemetry<typeof F358_FEATURE_ID>;

export const DEFAULT_F358_CONFIG: F358PaillierCiphertextRerandomizationBlinderConfig = {
  featureId: F358_FEATURE_ID,
  stage: F358_STAGE,
  operationCode: F358_OPERATION_CODE,
  contractVersion: F358_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F358PaillierCiphertextRerandomizationBlinderValidationError extends Error {
  public readonly featureId = F358_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F358 Validation Error on '${field}']: ${message}`);
    this.name = "F358PaillierCiphertextRerandomizationBlinderValidationError";
    this.field = field;
  }
}

export function computeF358Digest(rawPayload: string): string {
  return `f358_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F358PaillierCiphertextRerandomizationBlinderService extends KosmoraFeatureAdapterBase<
  typeof F358_FEATURE_ID,
  typeof F358_STAGE,
  typeof F358_OPERATION_CODE,
  F358PaillierCiphertextRerandomizationBlinderConfig,
  F358PaillierCiphertextRerandomizationBlinderInput,
  F358PaillierCiphertextRerandomizationBlinderOutput
> {
  constructor(customConfig?: Partial<F358PaillierCiphertextRerandomizationBlinderConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F358_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["original_cipher", "rerandomized_cipher", "same_plaintext", "unlinkable_ok"] as const,
      F358PaillierCiphertextRerandomizationBlinderValidationError
    );
  }
}

export function verifyF358Module(): {
  readonly featureId: typeof F358_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F358PaillierCiphertextRerandomizationBlinderService();
  const sampleInput: F358PaillierCiphertextRerandomizationBlinderInput = {
    requestId: "req_verify_f358",
    projectId: "proj_kosmora_f358",
    workspaceId: "ws_kosmora_f358",
    tenantId: "tenant_rlm_f358",
    actorId: "actor_verifier_f358",
    autonomyLevel: "A3",
    original_cipher: "seed_f358_original_cipher",
    rerandomized_cipher: 42,
    same_plaintext: true,
    unlinkable_ok: "seed_f358_unlinkable_ok",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F358" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F358" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_original_cipher !== sampleInput.original_cipher &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F358] Verification failed`);
  }

  return {
    featureId: F358_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
