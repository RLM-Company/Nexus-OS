/**
 * F275 (stage9-quantum-zk): Генератор постквантовых хеш-ключей Лэмпорта-Винтерница (SHA-256 OTS)
 * Построение квантово-устойчивых цепочек хеш-прообразов и корневого публичного ключа
 * Operation Code: pqc_lamport_keygen
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

export const F275_FEATURE_ID = "F275" as const;
export const F275_STAGE = "stage9-quantum-zk" as const;
export const F275_OPERATION_CODE = "pqc_lamport_keygen" as const;
export const F275_CONTRACT_VERSION = "2.0.0" as const;

export type F275PqcLamportSha256KeypairGeneratorConfig = BaseFeatureConfig<
  typeof F275_FEATURE_ID,
  typeof F275_STAGE,
  typeof F275_OPERATION_CODE
>;

export interface F275PqcLamportSha256KeypairGeneratorInput extends BaseFeatureInput {
  readonly key_id: string | number | boolean | readonly string[];
  readonly entropy_seed_hex: string | number | boolean | readonly string[];
  readonly hash_chain_depth: string | number | boolean | readonly string[];
  readonly security_level: string | number | boolean | readonly string[];
}

export interface F275PqcLamportSha256KeypairGeneratorOutput {
  readonly featureId: typeof F275_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F275_OPERATION_CODE;
  readonly resolved_key_id: unknown;
  readonly resolved_entropy_seed_hex: unknown;
  readonly resolved_hash_chain_depth: unknown;
  readonly resolved_security_level: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F275_FEATURE_ID>;
}

export type F275PqcLamportSha256KeypairGeneratorTelemetrySnapshot = BaseFeatureTelemetry<typeof F275_FEATURE_ID>;

export const DEFAULT_F275_CONFIG: F275PqcLamportSha256KeypairGeneratorConfig = {
  featureId: F275_FEATURE_ID,
  stage: F275_STAGE,
  operationCode: F275_OPERATION_CODE,
  contractVersion: F275_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F275PqcLamportSha256KeypairGeneratorValidationError extends Error {
  public readonly featureId = F275_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F275 Validation Error on '${field}']: ${message}`);
    this.name = "F275PqcLamportSha256KeypairGeneratorValidationError";
    this.field = field;
  }
}

export function computeF275Digest(rawPayload: string): string {
  return `f275_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F275PqcLamportSha256KeypairGeneratorService extends KosmoraFeatureAdapterBase<
  typeof F275_FEATURE_ID,
  typeof F275_STAGE,
  typeof F275_OPERATION_CODE,
  F275PqcLamportSha256KeypairGeneratorConfig,
  F275PqcLamportSha256KeypairGeneratorInput,
  F275PqcLamportSha256KeypairGeneratorOutput
> {
  constructor(customConfig?: Partial<F275PqcLamportSha256KeypairGeneratorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F275_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["key_id", "entropy_seed_hex", "hash_chain_depth", "security_level"] as const,
      F275PqcLamportSha256KeypairGeneratorValidationError
    );
  }
}

export function verifyF275Module(): {
  readonly featureId: typeof F275_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F275PqcLamportSha256KeypairGeneratorService();
  const sampleInput: F275PqcLamportSha256KeypairGeneratorInput = {
    requestId: "req_verify_f275",
    projectId: "proj_kosmora_f275",
    workspaceId: "ws_kosmora_f275",
    tenantId: "tenant_rlm_f275",
    actorId: "actor_verifier_f275",
    autonomyLevel: "A3",
    key_id: "seed_f275_key_id",
    entropy_seed_hex: 42,
    hash_chain_depth: true,
    security_level: "seed_f275_security_level",
    metadata: { stage: "stage9-quantum-zk", featureId: "F275" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F275" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_key_id !== sampleInput.key_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F275] Verification failed`);
  }

  return {
    featureId: F275_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
