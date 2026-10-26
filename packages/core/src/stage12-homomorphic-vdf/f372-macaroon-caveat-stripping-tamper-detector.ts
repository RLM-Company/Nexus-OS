/**
 * F372 (stage12-homomorphic-vdf): Детектор попыток удаления или модификации ограничений в макаруне
 * Мгновенный отказ в доступе при попытке суб-агента отрезать добавленный caveat и повысить свои права
 * Operation Code: macaroon_tamper_detector
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
import { Stage12HomomorphicVdfKernel } from "./stage-kernel.js";

export const F372_FEATURE_ID = "F372" as const;
export const F372_STAGE = "stage12-homomorphic-vdf" as const;
export const F372_OPERATION_CODE = "macaroon_tamper_detector" as const;
export const F372_CONTRACT_VERSION = "2.0.0" as const;

export type F372MacaroonCaveatStrippingTamperDetectorConfig = BaseFeatureConfig<
  typeof F372_FEATURE_ID,
  typeof F372_STAGE,
  typeof F372_OPERATION_CODE
>;

export interface F372MacaroonCaveatStrippingTamperDetectorInput extends BaseFeatureInput {
  readonly macaroon_id: string | number | boolean | readonly string[];
  readonly tampered_caveat_detected: string | number | boolean | readonly string[];
  readonly access_denied: string | number | boolean | readonly string[];
  readonly security_logged: string | number | boolean | readonly string[];
}

export interface F372MacaroonCaveatStrippingTamperDetectorOutput {
  readonly featureId: typeof F372_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F372_OPERATION_CODE;
  readonly resolved_macaroon_id: unknown;
  readonly resolved_tampered_caveat_detected: unknown;
  readonly resolved_access_denied: unknown;
  readonly resolved_security_logged: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F372_FEATURE_ID>;
}

export type F372MacaroonCaveatStrippingTamperDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F372_FEATURE_ID>;

export const DEFAULT_F372_CONFIG: F372MacaroonCaveatStrippingTamperDetectorConfig = {
  featureId: F372_FEATURE_ID,
  stage: F372_STAGE,
  operationCode: F372_OPERATION_CODE,
  contractVersion: F372_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F372MacaroonCaveatStrippingTamperDetectorValidationError extends Error {
  public readonly featureId = F372_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F372 Validation Error on '${field}']: ${message}`);
    this.name = "F372MacaroonCaveatStrippingTamperDetectorValidationError";
    this.field = field;
  }
}

export function computeF372Digest(rawPayload: string): string {
  return `f372_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F372MacaroonCaveatStrippingTamperDetectorService extends KosmoraFeatureAdapterBase<
  typeof F372_FEATURE_ID,
  typeof F372_STAGE,
  typeof F372_OPERATION_CODE,
  F372MacaroonCaveatStrippingTamperDetectorConfig,
  F372MacaroonCaveatStrippingTamperDetectorInput,
  F372MacaroonCaveatStrippingTamperDetectorOutput
> {
  constructor(customConfig?: Partial<F372MacaroonCaveatStrippingTamperDetectorConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F372_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["macaroon_id", "tampered_caveat_detected", "access_denied", "security_logged"] as const,
      F372MacaroonCaveatStrippingTamperDetectorValidationError
    );
  }
}

export function verifyF372Module(): {
  readonly featureId: typeof F372_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F372MacaroonCaveatStrippingTamperDetectorService();
  const sampleInput: F372MacaroonCaveatStrippingTamperDetectorInput = {
    requestId: "req_verify_f372",
    projectId: "proj_kosmora_f372",
    workspaceId: "ws_kosmora_f372",
    tenantId: "tenant_rlm_f372",
    actorId: "actor_verifier_f372",
    autonomyLevel: "A3",
    macaroon_id: "seed_f372_macaroon_id",
    tampered_caveat_detected: 42,
    access_denied: true,
    security_logged: "seed_f372_security_logged",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F372" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F372" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_macaroon_id !== sampleInput.macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F372] Verification failed`);
  }

  return {
    featureId: F372_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
