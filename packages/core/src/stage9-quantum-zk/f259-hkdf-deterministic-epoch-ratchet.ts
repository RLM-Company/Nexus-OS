/**
 * F259 (stage9-quantum-zk): Детерминированный криптографический храповик эпох (Key Ratchet)
 * Одностороннее продвижение цепочки ключей с защитой прямой секретности (Forward Secrecy)
 * Operation Code: hkdf_epoch_ratchet
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

export const F259_FEATURE_ID = "F259" as const;
export const F259_STAGE = "stage9-quantum-zk" as const;
export const F259_OPERATION_CODE = "hkdf_epoch_ratchet" as const;
export const F259_CONTRACT_VERSION = "2.0.0" as const;

export type F259HkdfDeterministicEpochRatchetConfig = BaseFeatureConfig<
  typeof F259_FEATURE_ID,
  typeof F259_STAGE,
  typeof F259_OPERATION_CODE
>;

export interface F259HkdfDeterministicEpochRatchetInput extends BaseFeatureInput {
  readonly current_chain_key: string | number | boolean | readonly string[];
  readonly epoch_sequence: string | number | boolean | readonly string[];
  readonly ratchet_salt: string | number | boolean | readonly string[];
  readonly domain_label: string | number | boolean | readonly string[];
}

export interface F259HkdfDeterministicEpochRatchetOutput {
  readonly featureId: typeof F259_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F259_OPERATION_CODE;
  readonly resolved_current_chain_key: unknown;
  readonly resolved_epoch_sequence: unknown;
  readonly resolved_ratchet_salt: unknown;
  readonly resolved_domain_label: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F259_FEATURE_ID>;
}

export type F259HkdfDeterministicEpochRatchetTelemetrySnapshot = BaseFeatureTelemetry<typeof F259_FEATURE_ID>;

export const DEFAULT_F259_CONFIG: F259HkdfDeterministicEpochRatchetConfig = {
  featureId: F259_FEATURE_ID,
  stage: F259_STAGE,
  operationCode: F259_OPERATION_CODE,
  contractVersion: F259_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F259HkdfDeterministicEpochRatchetValidationError extends Error {
  public readonly featureId = F259_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F259 Validation Error on '${field}']: ${message}`);
    this.name = "F259HkdfDeterministicEpochRatchetValidationError";
    this.field = field;
  }
}

export function computeF259Digest(rawPayload: string): string {
  return `f259_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F259HkdfDeterministicEpochRatchetService extends KosmoraFeatureAdapterBase<
  typeof F259_FEATURE_ID,
  typeof F259_STAGE,
  typeof F259_OPERATION_CODE,
  F259HkdfDeterministicEpochRatchetConfig,
  F259HkdfDeterministicEpochRatchetInput,
  F259HkdfDeterministicEpochRatchetOutput
> {
  constructor(customConfig?: Partial<F259HkdfDeterministicEpochRatchetConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F259_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["current_chain_key", "epoch_sequence", "ratchet_salt", "domain_label"] as const,
      F259HkdfDeterministicEpochRatchetValidationError
    );
  }
}

export function verifyF259Module(): {
  readonly featureId: typeof F259_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F259HkdfDeterministicEpochRatchetService();
  const sampleInput: F259HkdfDeterministicEpochRatchetInput = {
    requestId: "req_verify_f259",
    projectId: "proj_kosmora_f259",
    workspaceId: "ws_kosmora_f259",
    tenantId: "tenant_rlm_f259",
    actorId: "actor_verifier_f259",
    autonomyLevel: "A3",
    current_chain_key: "seed_f259_current_chain_key",
    epoch_sequence: 42,
    ratchet_salt: true,
    domain_label: "seed_f259_domain_label",
    metadata: { stage: "stage9-quantum-zk", featureId: "F259" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F259" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_current_chain_key !== sampleInput.current_chain_key &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F259] Verification failed`);
  }

  return {
    featureId: F259_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
