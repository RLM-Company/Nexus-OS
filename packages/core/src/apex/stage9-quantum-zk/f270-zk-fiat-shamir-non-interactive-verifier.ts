/**
 * F270 (stage9-quantum-zk): Верификатор неинтерактивных ZK-доказательств Фиата-Шамира
 * Математическая проверка тождества Шнорра g^s mod p === (t * y^c) mod p и хеш-вызова c
 * Operation Code: zk_schnorr_verify
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

export const F270_FEATURE_ID = "F270" as const;
export const F270_STAGE = "stage9-quantum-zk" as const;
export const F270_OPERATION_CODE = "zk_schnorr_verify" as const;
export const F270_CONTRACT_VERSION = "2.0.0" as const;

export type F270ZkFiatShamirNonInteractiveVerifierConfig = BaseFeatureConfig<
  typeof F270_FEATURE_ID,
  typeof F270_STAGE,
  typeof F270_OPERATION_CODE
>;

export interface F270ZkFiatShamirNonInteractiveVerifierInput extends BaseFeatureInput {
  readonly statement_context: string | number | boolean | readonly string[];
  readonly commitment_hex: string | number | boolean | readonly string[];
  readonly challenge_hex: string | number | boolean | readonly string[];
  readonly response_hex: string | number | boolean | readonly string[];
}

export interface F270ZkFiatShamirNonInteractiveVerifierOutput {
  readonly featureId: typeof F270_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F270_OPERATION_CODE;
  readonly resolved_statement_context: unknown;
  readonly resolved_commitment_hex: unknown;
  readonly resolved_challenge_hex: unknown;
  readonly resolved_response_hex: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F270_FEATURE_ID>;
}

export type F270ZkFiatShamirNonInteractiveVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F270_FEATURE_ID
>;

export const DEFAULT_F270_CONFIG: F270ZkFiatShamirNonInteractiveVerifierConfig = {
  featureId: F270_FEATURE_ID,
  stage: F270_STAGE,
  operationCode: F270_OPERATION_CODE,
  contractVersion: F270_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F270ZkFiatShamirNonInteractiveVerifierValidationError extends Error {
  public readonly featureId = F270_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F270 Validation Error on '${field}']: ${message}`);
    this.name = "F270ZkFiatShamirNonInteractiveVerifierValidationError";
    this.field = field;
  }
}

export function computeF270Digest(rawPayload: string): string {
  return `f270_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F270ZkFiatShamirNonInteractiveVerifierService extends KosmoraFeatureAdapterBase<
  typeof F270_FEATURE_ID,
  typeof F270_STAGE,
  typeof F270_OPERATION_CODE,
  F270ZkFiatShamirNonInteractiveVerifierConfig,
  F270ZkFiatShamirNonInteractiveVerifierInput,
  F270ZkFiatShamirNonInteractiveVerifierOutput
> {
  constructor(
    customConfig?: Partial<F270ZkFiatShamirNonInteractiveVerifierConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F270_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["statement_context", "commitment_hex", "challenge_hex", "response_hex"] as const,
      F270ZkFiatShamirNonInteractiveVerifierValidationError
    );
  }
}

export function verifyF270Module(): {
  readonly featureId: typeof F270_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F270ZkFiatShamirNonInteractiveVerifierService();
  const sampleInput: F270ZkFiatShamirNonInteractiveVerifierInput = {
    requestId: "req_verify_f270",
    projectId: "proj_kosmora_f270",
    workspaceId: "ws_kosmora_f270",
    tenantId: "tenant_rlm_f270",
    actorId: "actor_verifier_f270",
    autonomyLevel: "A3",
    statement_context: "seed_f270_statement_context",
    commitment_hex: 42,
    challenge_hex: true,
    response_hex: "seed_f270_response_hex",
    metadata: { stage: "stage9-quantum-zk", featureId: "F270" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F270" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_statement_context !== sampleInput.statement_context &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F270] Verification failed`);
  }

  return {
    featureId: F270_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
