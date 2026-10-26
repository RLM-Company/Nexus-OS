/**
 * F197 (stage7-formal-verification): Верификатор свойств безопасности (Safety Properties) протокола Kosmora
 * Проверка инварианта невозможности перехода в состояние списания средств без предварительного аппрува
 * Operation Code: protocol_safety_property_verifier
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

export const F197_FEATURE_ID = "F197" as const;
export const F197_STAGE = "stage7-formal-verification" as const;
export const F197_OPERATION_CODE = "protocol_safety_property_verifier" as const;
export const F197_CONTRACT_VERSION = "2.0.0" as const;

export type F197ProtocolSafetyPropertyVerifierConfig = BaseFeatureConfig<
  typeof F197_FEATURE_ID,
  typeof F197_STAGE,
  typeof F197_OPERATION_CODE
>;

export interface F197ProtocolSafetyPropertyVerifierInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly checked_transitions: string | number | boolean | readonly string[];
  readonly safety_verified: string | number | boolean | readonly string[];
  readonly verification_hash: string | number | boolean | readonly string[];
}

export interface F197ProtocolSafetyPropertyVerifierOutput {
  readonly featureId: typeof F197_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F197_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_checked_transitions: unknown;
  readonly resolved_safety_verified: unknown;
  readonly resolved_verification_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F197_FEATURE_ID>;
}

export type F197ProtocolSafetyPropertyVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F197_FEATURE_ID>;

export const DEFAULT_F197_CONFIG: F197ProtocolSafetyPropertyVerifierConfig = {
  featureId: F197_FEATURE_ID,
  stage: F197_STAGE,
  operationCode: F197_OPERATION_CODE,
  contractVersion: F197_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F197ProtocolSafetyPropertyVerifierValidationError extends Error {
  public readonly featureId = F197_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F197 Validation Error on '${field}']: ${message}`);
    this.name = "F197ProtocolSafetyPropertyVerifierValidationError";
    this.field = field;
  }
}

export function computeF197Digest(rawPayload: string): string {
  return `f197_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F197ProtocolSafetyPropertyVerifierService extends KosmoraFeatureAdapterBase<
  typeof F197_FEATURE_ID,
  typeof F197_STAGE,
  typeof F197_OPERATION_CODE,
  F197ProtocolSafetyPropertyVerifierConfig,
  F197ProtocolSafetyPropertyVerifierInput,
  F197ProtocolSafetyPropertyVerifierOutput
> {
  constructor(customConfig?: Partial<F197ProtocolSafetyPropertyVerifierConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F197_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "checked_transitions", "safety_verified", "verification_hash"] as const,
      F197ProtocolSafetyPropertyVerifierValidationError
    );
  }
}

export function verifyF197Module(): {
  readonly featureId: typeof F197_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F197ProtocolSafetyPropertyVerifierService();
  const sampleInput: F197ProtocolSafetyPropertyVerifierInput = {
    requestId: "req_verify_f197",
    projectId: "proj_kosmora_f197",
    workspaceId: "ws_kosmora_f197",
    tenantId: "tenant_rlm_f197",
    actorId: "actor_verifier_f197",
    autonomyLevel: "A3",
    model_id: "seed_f197_model_id",
    checked_transitions: 42,
    safety_verified: true,
    verification_hash: "seed_f197_verification_hash",
    metadata: { stage: "stage7-formal-verification", featureId: "F197" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F197" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F197] Verification failed`);
  }

  return {
    featureId: F197_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
