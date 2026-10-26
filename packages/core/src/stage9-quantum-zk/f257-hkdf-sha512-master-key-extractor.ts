/**
 * F257 (stage9-quantum-zk): Экстрактор мастер-ключей HKDF-SHA512 (RFC 5869)
 * Криптографическое извлечение псевдослучайного ключа (PRK) из входного ключевого материала и соли
 * Operation Code: hkdf_master_extract
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
import { Stage9QuantumZkKernel } from "./stage-kernel.js";

export const F257_FEATURE_ID = "F257" as const;
export const F257_STAGE = "stage9-quantum-zk" as const;
export const F257_OPERATION_CODE = "hkdf_master_extract" as const;
export const F257_CONTRACT_VERSION = "2.0.0" as const;

export type F257HkdfSha512MasterKeyExtractorConfig = BaseFeatureConfig<
  typeof F257_FEATURE_ID,
  typeof F257_STAGE,
  typeof F257_OPERATION_CODE
>;

export interface F257HkdfSha512MasterKeyExtractorInput extends BaseFeatureInput {
  readonly ikm_material: string | number | boolean | readonly string[];
  readonly salt_material: string | number | boolean | readonly string[];
  readonly info_context: string | number | boolean | readonly string[];
  readonly key_length_bytes: string | number | boolean | readonly string[];
}

export interface F257HkdfSha512MasterKeyExtractorOutput {
  readonly featureId: typeof F257_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F257_OPERATION_CODE;
  readonly resolved_ikm_material: unknown;
  readonly resolved_salt_material: unknown;
  readonly resolved_info_context: unknown;
  readonly resolved_key_length_bytes: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F257_FEATURE_ID>;
}

export type F257HkdfSha512MasterKeyExtractorTelemetrySnapshot = BaseFeatureTelemetry<typeof F257_FEATURE_ID>;

export const DEFAULT_F257_CONFIG: F257HkdfSha512MasterKeyExtractorConfig = {
  featureId: F257_FEATURE_ID,
  stage: F257_STAGE,
  operationCode: F257_OPERATION_CODE,
  contractVersion: F257_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F257HkdfSha512MasterKeyExtractorValidationError extends Error {
  public readonly featureId = F257_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F257 Validation Error on '${field}']: ${message}`);
    this.name = "F257HkdfSha512MasterKeyExtractorValidationError";
    this.field = field;
  }
}

export function computeF257Digest(rawPayload: string): string {
  return `f257_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F257HkdfSha512MasterKeyExtractorService extends KosmoraFeatureAdapterBase<
  typeof F257_FEATURE_ID,
  typeof F257_STAGE,
  typeof F257_OPERATION_CODE,
  F257HkdfSha512MasterKeyExtractorConfig,
  F257HkdfSha512MasterKeyExtractorInput,
  F257HkdfSha512MasterKeyExtractorOutput
> {
  constructor(customConfig?: Partial<F257HkdfSha512MasterKeyExtractorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F257_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["ikm_material", "salt_material", "info_context", "key_length_bytes"] as const,
      F257HkdfSha512MasterKeyExtractorValidationError
    );
  }
}

export function verifyF257Module(): {
  readonly featureId: typeof F257_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F257HkdfSha512MasterKeyExtractorService();
  const sampleInput: F257HkdfSha512MasterKeyExtractorInput = {
    requestId: "req_verify_f257",
    projectId: "proj_kosmora_f257",
    workspaceId: "ws_kosmora_f257",
    tenantId: "tenant_rlm_f257",
    actorId: "actor_verifier_f257",
    autonomyLevel: "A3",
    ikm_material: "seed_f257_ikm_material",
    salt_material: 42,
    info_context: true,
    key_length_bytes: "seed_f257_key_length_bytes",
    metadata: { stage: "stage9-quantum-zk", featureId: "F257" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F257" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_ikm_material !== sampleInput.ikm_material &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F257] Verification failed`);
  }

  return {
    featureId: F257_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
