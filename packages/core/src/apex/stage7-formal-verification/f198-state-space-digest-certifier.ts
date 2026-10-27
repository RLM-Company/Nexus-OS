/**
 * F198 (stage7-formal-verification): Криптографический сертификатор пространства состояний автомата
 * Вычисление детерминированного SHA-256 отпечатка графа переходов после успешной верификации модели
 * Operation Code: state_space_digest_certifier
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

export const F198_FEATURE_ID = "F198" as const;
export const F198_STAGE = "stage7-formal-verification" as const;
export const F198_OPERATION_CODE = "state_space_digest_certifier" as const;
export const F198_CONTRACT_VERSION = "2.0.0" as const;

export type F198StateSpaceDigestCertifierConfig = BaseFeatureConfig<
  typeof F198_FEATURE_ID,
  typeof F198_STAGE,
  typeof F198_OPERATION_CODE
>;

export interface F198StateSpaceDigestCertifierInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly visited_states: string | number | boolean | readonly string[];
  readonly checked_transitions: string | number | boolean | readonly string[];
  readonly certificate_sha256: string | number | boolean | readonly string[];
}

export interface F198StateSpaceDigestCertifierOutput {
  readonly featureId: typeof F198_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F198_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_visited_states: unknown;
  readonly resolved_checked_transitions: unknown;
  readonly resolved_certificate_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F198_FEATURE_ID>;
}

export type F198StateSpaceDigestCertifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F198_FEATURE_ID
>;

export const DEFAULT_F198_CONFIG: F198StateSpaceDigestCertifierConfig = {
  featureId: F198_FEATURE_ID,
  stage: F198_STAGE,
  operationCode: F198_OPERATION_CODE,
  contractVersion: F198_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F198StateSpaceDigestCertifierValidationError extends Error {
  public readonly featureId = F198_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F198 Validation Error on '${field}']: ${message}`);
    this.name = "F198StateSpaceDigestCertifierValidationError";
    this.field = field;
  }
}

export function computeF198Digest(rawPayload: string): string {
  return `f198_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F198StateSpaceDigestCertifierService extends KosmoraFeatureAdapterBase<
  typeof F198_FEATURE_ID,
  typeof F198_STAGE,
  typeof F198_OPERATION_CODE,
  F198StateSpaceDigestCertifierConfig,
  F198StateSpaceDigestCertifierInput,
  F198StateSpaceDigestCertifierOutput
> {
  constructor(
    customConfig?: Partial<F198StateSpaceDigestCertifierConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F198_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "visited_states", "checked_transitions", "certificate_sha256"] as const,
      F198StateSpaceDigestCertifierValidationError
    );
  }
}

export function verifyF198Module(): {
  readonly featureId: typeof F198_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F198StateSpaceDigestCertifierService();
  const sampleInput: F198StateSpaceDigestCertifierInput = {
    requestId: "req_verify_f198",
    projectId: "proj_kosmora_f198",
    workspaceId: "ws_kosmora_f198",
    tenantId: "tenant_rlm_f198",
    actorId: "actor_verifier_f198",
    autonomyLevel: "A3",
    model_id: "seed_f198_model_id",
    visited_states: 42,
    checked_transitions: true,
    certificate_sha256: "seed_f198_certificate_sha256",
    metadata: { stage: "stage7-formal-verification", featureId: "F198" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F198" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F198] Verification failed`);
  }

  return {
    featureId: F198_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
