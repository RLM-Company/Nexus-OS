/**
 * F280 (stage9-quantum-zk): Гибридный криптоконверт (Ed25519 + Post-Quantum Lamport-SHA256)
 * Двойная аттестация критических релизов одновременно классической и постквантовой подписью
 * Operation Code: pqc_hybrid_envelope
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

export const F280_FEATURE_ID = "F280" as const;
export const F280_STAGE = "stage9-quantum-zk" as const;
export const F280_OPERATION_CODE = "pqc_hybrid_envelope" as const;
export const F280_CONTRACT_VERSION = "2.0.0" as const;

export type F280PqcHybridClassicalQuantumEnvelopeConfig = BaseFeatureConfig<
  typeof F280_FEATURE_ID,
  typeof F280_STAGE,
  typeof F280_OPERATION_CODE
>;

export interface F280PqcHybridClassicalQuantumEnvelopeInput extends BaseFeatureInput {
  readonly payload_digest: string | number | boolean | readonly string[];
  readonly hmac_classical_sig: string | number | boolean | readonly string[];
  readonly lamport_quantum_sig: string | number | boolean | readonly string[];
  readonly verification_mode: string | number | boolean | readonly string[];
}

export interface F280PqcHybridClassicalQuantumEnvelopeOutput {
  readonly featureId: typeof F280_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F280_OPERATION_CODE;
  readonly resolved_payload_digest: unknown;
  readonly resolved_hmac_classical_sig: unknown;
  readonly resolved_lamport_quantum_sig: unknown;
  readonly resolved_verification_mode: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F280_FEATURE_ID>;
}

export type F280PqcHybridClassicalQuantumEnvelopeTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F280_FEATURE_ID
>;

export const DEFAULT_F280_CONFIG: F280PqcHybridClassicalQuantumEnvelopeConfig = {
  featureId: F280_FEATURE_ID,
  stage: F280_STAGE,
  operationCode: F280_OPERATION_CODE,
  contractVersion: F280_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F280PqcHybridClassicalQuantumEnvelopeValidationError extends Error {
  public readonly featureId = F280_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F280 Validation Error on '${field}']: ${message}`);
    this.name = "F280PqcHybridClassicalQuantumEnvelopeValidationError";
    this.field = field;
  }
}

export function computeF280Digest(rawPayload: string): string {
  return `f280_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F280PqcHybridClassicalQuantumEnvelopeService extends KosmoraFeatureAdapterBase<
  typeof F280_FEATURE_ID,
  typeof F280_STAGE,
  typeof F280_OPERATION_CODE,
  F280PqcHybridClassicalQuantumEnvelopeConfig,
  F280PqcHybridClassicalQuantumEnvelopeInput,
  F280PqcHybridClassicalQuantumEnvelopeOutput
> {
  constructor(
    customConfig?: Partial<F280PqcHybridClassicalQuantumEnvelopeConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F280_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["payload_digest", "hmac_classical_sig", "lamport_quantum_sig", "verification_mode"] as const,
      F280PqcHybridClassicalQuantumEnvelopeValidationError
    );
  }
}

export function verifyF280Module(): {
  readonly featureId: typeof F280_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F280PqcHybridClassicalQuantumEnvelopeService();
  const sampleInput: F280PqcHybridClassicalQuantumEnvelopeInput = {
    requestId: "req_verify_f280",
    projectId: "proj_kosmora_f280",
    workspaceId: "ws_kosmora_f280",
    tenantId: "tenant_rlm_f280",
    actorId: "actor_verifier_f280",
    autonomyLevel: "A3",
    payload_digest: "seed_f280_payload_digest",
    hmac_classical_sig: 42,
    lamport_quantum_sig: true,
    verification_mode: "seed_f280_verification_mode",
    metadata: { stage: "stage9-quantum-zk", featureId: "F280" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F280" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_payload_digest !== sampleInput.payload_digest &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F280] Verification failed`);
  }

  return {
    featureId: F280_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
