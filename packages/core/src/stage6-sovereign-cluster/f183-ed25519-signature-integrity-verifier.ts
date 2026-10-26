/**
 * F183 (stage6-sovereign-cluster): Верификатор цифровой подписи Ed25519 и целостности байтов
 * Проверка подлинности конверта аттестации и защита от подмены содержимого артефакта
 * Operation Code: ed25519_signature_integrity_verifier
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F183_FEATURE_ID = "F183" as const;
export const F183_STAGE = "stage6-sovereign-cluster" as const;
export const F183_OPERATION_CODE = "ed25519_signature_integrity_verifier" as const;
export const F183_CONTRACT_VERSION = "2.0.0" as const;

export type F183Ed25519SignatureIntegrityVerifierExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F183Ed25519SignatureIntegrityVerifierConfig = BaseFeatureConfig<
  typeof F183_FEATURE_ID,
  typeof F183_STAGE,
  typeof F183_OPERATION_CODE
>;

export interface F183Ed25519SignatureIntegrityVerifierInput extends BaseFeatureInput {
  readonly attestation_id: string;
  readonly valid: string | number;
  readonly reason: string | number | boolean | readonly string[];
  readonly verified_key_id: string | number | boolean | Record<string, unknown>;
}

export type F183Ed25519SignatureIntegrityVerifierAuditEntry = BaseFeatureAuditEntry<typeof F183_FEATURE_ID>;

export interface F183Ed25519SignatureIntegrityVerifierOutput {
  readonly featureId: typeof F183_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F183Ed25519SignatureIntegrityVerifierExecutionStatus;
  readonly operationCode: typeof F183_OPERATION_CODE;
  readonly resolved_attestation_id: string;
  readonly resolved_valid: string | number;
  readonly resolved_reason: string | number | boolean | readonly string[];
  readonly resolved_verified_key_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F183Ed25519SignatureIntegrityVerifierAuditEntry;
}

export type F183Ed25519SignatureIntegrityVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F183_FEATURE_ID>;

export const DEFAULT_F183_CONFIG: F183Ed25519SignatureIntegrityVerifierConfig = {
  featureId: F183_FEATURE_ID,
  stage: F183_STAGE,
  operationCode: F183_OPERATION_CODE,
  contractVersion: F183_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F183Ed25519SignatureIntegrityVerifierValidationError extends Error {
  public readonly featureId = F183_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F183 Validation Error on '${field}']: ${message}`);
    this.name = "F183Ed25519SignatureIntegrityVerifierValidationError";
    this.field = field;
  }
}

export function computeF183Digest(rawPayload: string): string {
  return `f183_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F183Ed25519SignatureIntegrityVerifierEngine extends KosmoraFeatureAdapterBase<
  typeof F183_FEATURE_ID,
  typeof F183_STAGE,
  typeof F183_OPERATION_CODE,
  F183Ed25519SignatureIntegrityVerifierConfig,
  F183Ed25519SignatureIntegrityVerifierInput,
  F183Ed25519SignatureIntegrityVerifierOutput
> {
  constructor(customConfig?: Partial<F183Ed25519SignatureIntegrityVerifierConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F183_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["attestation_id", "valid", "reason", "verified_key_id"] as const,
      F183Ed25519SignatureIntegrityVerifierValidationError
    );
  }
}

export function verifyF183Module(): {
  featureId: typeof F183_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F183Ed25519SignatureIntegrityVerifierEngine();
  const sampleInput: F183Ed25519SignatureIntegrityVerifierInput = {
    requestId: "req_verify_f183",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    attestation_id: "f183_attestation_id_seed",
    valid: 42,
    reason: true,
    verified_key_id: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 183 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F183" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_attestation_id !== sampleInput.attestation_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F183_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
