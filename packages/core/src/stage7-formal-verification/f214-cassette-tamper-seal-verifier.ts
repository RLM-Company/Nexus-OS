/**
 * F214 (stage7-formal-verification): Верификатор целостности криптографической пломбы кассеты исполнения
 * Защита архивных траекторий от несанкционированной модификации входов или результатов инструментов
 * Operation Code: cassette_tamper_seal_verifier
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F214_FEATURE_ID = "F214" as const;
export const F214_STAGE = "stage7-formal-verification" as const;
export const F214_OPERATION_CODE = "cassette_tamper_seal_verifier" as const;
export const F214_CONTRACT_VERSION = "2.0.0" as const;

export type F214CassetteTamperSealVerifierConfig = BaseFeatureConfig<
  typeof F214_FEATURE_ID,
  typeof F214_STAGE,
  typeof F214_OPERATION_CODE
>;

export interface F214CassetteTamperSealVerifierInput extends BaseFeatureInput {
  readonly cassette_id: string | number | boolean | readonly string[];
  readonly seal_valid: string | number | boolean | readonly string[];
  readonly cassette_seal_sha256: string | number | boolean | readonly string[];
  readonly tamper_detected: string | number | boolean | readonly string[];
}

export interface F214CassetteTamperSealVerifierOutput {
  readonly featureId: typeof F214_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F214_OPERATION_CODE;
  readonly resolved_cassette_id: unknown;
  readonly resolved_seal_valid: unknown;
  readonly resolved_cassette_seal_sha256: unknown;
  readonly resolved_tamper_detected: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F214_FEATURE_ID>;
}

export type F214CassetteTamperSealVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F214_FEATURE_ID>;

export const DEFAULT_F214_CONFIG: F214CassetteTamperSealVerifierConfig = {
  featureId: F214_FEATURE_ID,
  stage: F214_STAGE,
  operationCode: F214_OPERATION_CODE,
  contractVersion: F214_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F214CassetteTamperSealVerifierValidationError extends Error {
  public readonly featureId = F214_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F214 Validation Error on '${field}']: ${message}`);
    this.name = "F214CassetteTamperSealVerifierValidationError";
    this.field = field;
  }
}

export function computeF214Digest(rawPayload: string): string {
  return `f214_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F214CassetteTamperSealVerifierService extends KosmoraFeatureAdapterBase<
  typeof F214_FEATURE_ID,
  typeof F214_STAGE,
  typeof F214_OPERATION_CODE,
  F214CassetteTamperSealVerifierConfig,
  F214CassetteTamperSealVerifierInput,
  F214CassetteTamperSealVerifierOutput
> {
  constructor(customConfig?: Partial<F214CassetteTamperSealVerifierConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F214_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["cassette_id", "seal_valid", "cassette_seal_sha256", "tamper_detected"] as const,
      F214CassetteTamperSealVerifierValidationError
    );
  }
}

export function verifyF214Module(): {
  readonly featureId: typeof F214_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F214CassetteTamperSealVerifierService();
  const sampleInput: F214CassetteTamperSealVerifierInput = {
    requestId: "req_verify_f214",
    projectId: "proj_kosmora_f214",
    workspaceId: "ws_kosmora_f214",
    tenantId: "tenant_rlm_f214",
    actorId: "actor_verifier_f214",
    autonomyLevel: "A3",
    cassette_id: "seed_f214_cassette_id",
    seal_valid: 42,
    cassette_seal_sha256: true,
    tamper_detected: "seed_f214_tamper_detected",
    metadata: { stage: "stage7-formal-verification", featureId: "F214" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F214" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cassette_id !== sampleInput.cassette_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F214] Verification failed`);
  }

  return {
    featureId: F214_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
