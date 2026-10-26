/**
 * F276 (stage9-quantum-zk): Постквантовый подписант сообщений на базе хеш-цепочек (Lamport-SHA256)
 * Формирование квантово-устойчивой подписи без опоры на факторизацию или дискретный логарифм
 * Operation Code: pqc_lamport_sign
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

export const F276_FEATURE_ID = "F276" as const;
export const F276_STAGE = "stage9-quantum-zk" as const;
export const F276_OPERATION_CODE = "pqc_lamport_sign" as const;
export const F276_CONTRACT_VERSION = "2.0.0" as const;

export type F276PqcLamportOneTimeMessageSignerConfig = BaseFeatureConfig<
  typeof F276_FEATURE_ID,
  typeof F276_STAGE,
  typeof F276_OPERATION_CODE
>;

export interface F276PqcLamportOneTimeMessageSignerInput extends BaseFeatureInput {
  readonly message_payload: string | number | boolean | readonly string[];
  readonly key_seed_hex: string | number | boolean | readonly string[];
  readonly signature_counter: string | number | boolean | readonly string[];
  readonly domain_context: string | number | boolean | readonly string[];
}

export interface F276PqcLamportOneTimeMessageSignerOutput {
  readonly featureId: typeof F276_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F276_OPERATION_CODE;
  readonly resolved_message_payload: unknown;
  readonly resolved_key_seed_hex: unknown;
  readonly resolved_signature_counter: unknown;
  readonly resolved_domain_context: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F276_FEATURE_ID>;
}

export type F276PqcLamportOneTimeMessageSignerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F276_FEATURE_ID
>;

export const DEFAULT_F276_CONFIG: F276PqcLamportOneTimeMessageSignerConfig = {
  featureId: F276_FEATURE_ID,
  stage: F276_STAGE,
  operationCode: F276_OPERATION_CODE,
  contractVersion: F276_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F276PqcLamportOneTimeMessageSignerValidationError extends Error {
  public readonly featureId = F276_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F276 Validation Error on '${field}']: ${message}`);
    this.name = "F276PqcLamportOneTimeMessageSignerValidationError";
    this.field = field;
  }
}

export function computeF276Digest(rawPayload: string): string {
  return `f276_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F276PqcLamportOneTimeMessageSignerService extends KosmoraFeatureAdapterBase<
  typeof F276_FEATURE_ID,
  typeof F276_STAGE,
  typeof F276_OPERATION_CODE,
  F276PqcLamportOneTimeMessageSignerConfig,
  F276PqcLamportOneTimeMessageSignerInput,
  F276PqcLamportOneTimeMessageSignerOutput
> {
  constructor(
    customConfig?: Partial<F276PqcLamportOneTimeMessageSignerConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F276_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["message_payload", "key_seed_hex", "signature_counter", "domain_context"] as const,
      F276PqcLamportOneTimeMessageSignerValidationError
    );
  }
}

export function verifyF276Module(): {
  readonly featureId: typeof F276_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F276PqcLamportOneTimeMessageSignerService();
  const sampleInput: F276PqcLamportOneTimeMessageSignerInput = {
    requestId: "req_verify_f276",
    projectId: "proj_kosmora_f276",
    workspaceId: "ws_kosmora_f276",
    tenantId: "tenant_rlm_f276",
    actorId: "actor_verifier_f276",
    autonomyLevel: "A3",
    message_payload: "seed_f276_message_payload",
    key_seed_hex: 42,
    signature_counter: true,
    domain_context: "seed_f276_domain_context",
    metadata: { stage: "stage9-quantum-zk", featureId: "F276" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F276" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_message_payload !== sampleInput.message_payload &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F276] Verification failed`);
  }

  return {
    featureId: F276_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
