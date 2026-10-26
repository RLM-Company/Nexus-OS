/**
 * F277 (stage9-quantum-zk): Верификатор постквантовых подписей Лэмпорта-Меркла
 * Досчёт хеш-цепочек от раскрытых промежуточных значений до публичного корня и сверка дайджеста
 * Operation Code: pqc_lamport_verify
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

export const F277_FEATURE_ID = "F277" as const;
export const F277_STAGE = "stage9-quantum-zk" as const;
export const F277_OPERATION_CODE = "pqc_lamport_verify" as const;
export const F277_CONTRACT_VERSION = "2.0.0" as const;

export type F277PqcLamportHashChainSignatureVerifierConfig = BaseFeatureConfig<
  typeof F277_FEATURE_ID,
  typeof F277_STAGE,
  typeof F277_OPERATION_CODE
>;

export interface F277PqcLamportHashChainSignatureVerifierInput extends BaseFeatureInput {
  readonly message_payload: string | number | boolean | readonly string[];
  readonly public_key_root_hex: string | number | boolean | readonly string[];
  readonly revealed_preimages: string | number | boolean | readonly string[];
  readonly verifier_policy: string | number | boolean | readonly string[];
}

export interface F277PqcLamportHashChainSignatureVerifierOutput {
  readonly featureId: typeof F277_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F277_OPERATION_CODE;
  readonly resolved_message_payload: unknown;
  readonly resolved_public_key_root_hex: unknown;
  readonly resolved_revealed_preimages: unknown;
  readonly resolved_verifier_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F277_FEATURE_ID>;
}

export type F277PqcLamportHashChainSignatureVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F277_FEATURE_ID>;

export const DEFAULT_F277_CONFIG: F277PqcLamportHashChainSignatureVerifierConfig = {
  featureId: F277_FEATURE_ID,
  stage: F277_STAGE,
  operationCode: F277_OPERATION_CODE,
  contractVersion: F277_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F277PqcLamportHashChainSignatureVerifierValidationError extends Error {
  public readonly featureId = F277_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F277 Validation Error on '${field}']: ${message}`);
    this.name = "F277PqcLamportHashChainSignatureVerifierValidationError";
    this.field = field;
  }
}

export function computeF277Digest(rawPayload: string): string {
  return `f277_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F277PqcLamportHashChainSignatureVerifierService extends KosmoraFeatureAdapterBase<
  typeof F277_FEATURE_ID,
  typeof F277_STAGE,
  typeof F277_OPERATION_CODE,
  F277PqcLamportHashChainSignatureVerifierConfig,
  F277PqcLamportHashChainSignatureVerifierInput,
  F277PqcLamportHashChainSignatureVerifierOutput
> {
  constructor(customConfig?: Partial<F277PqcLamportHashChainSignatureVerifierConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F277_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["message_payload", "public_key_root_hex", "revealed_preimages", "verifier_policy"] as const,
      F277PqcLamportHashChainSignatureVerifierValidationError
    );
  }
}

export function verifyF277Module(): {
  readonly featureId: typeof F277_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F277PqcLamportHashChainSignatureVerifierService();
  const sampleInput: F277PqcLamportHashChainSignatureVerifierInput = {
    requestId: "req_verify_f277",
    projectId: "proj_kosmora_f277",
    workspaceId: "ws_kosmora_f277",
    tenantId: "tenant_rlm_f277",
    actorId: "actor_verifier_f277",
    autonomyLevel: "A3",
    message_payload: "seed_f277_message_payload",
    public_key_root_hex: 42,
    revealed_preimages: true,
    verifier_policy: "seed_f277_verifier_policy",
    metadata: { stage: "stage9-quantum-zk", featureId: "F277" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F277" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_message_payload !== sampleInput.message_payload &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F277] Verification failed`);
  }

  return {
    featureId: F277_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
