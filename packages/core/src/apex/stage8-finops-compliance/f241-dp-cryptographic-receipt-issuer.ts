/**
 * F241 (stage8-finops-compliance): Эмитент криптографических квитанций соблюдения дифференциальной приватности
 * Формирование неизменяемого SHA-256 подтверждения параметров шума и остатка бюджета ε для аудиторов
 * Operation Code: dp_cryptographic_receipt_issuer
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F241_FEATURE_ID = "F241" as const;
export const F241_STAGE = "stage8-finops-compliance" as const;
export const F241_OPERATION_CODE = "dp_cryptographic_receipt_issuer" as const;
export const F241_CONTRACT_VERSION = "2.0.0" as const;

export type F241DpCryptographicReceiptIssuerConfig = BaseFeatureConfig<
  typeof F241_FEATURE_ID,
  typeof F241_STAGE,
  typeof F241_OPERATION_CODE
>;

export interface F241DpCryptographicReceiptIssuerInput extends BaseFeatureInput {
  readonly query_id: string | number | boolean | readonly string[];
  readonly privatized_value: string | number | boolean | readonly string[];
  readonly remaining_epsilon: string | number | boolean | readonly string[];
  readonly dp_receipt_sha256: string | number | boolean | readonly string[];
}

export interface F241DpCryptographicReceiptIssuerOutput {
  readonly featureId: typeof F241_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F241_OPERATION_CODE;
  readonly resolved_query_id: unknown;
  readonly resolved_privatized_value: unknown;
  readonly resolved_remaining_epsilon: unknown;
  readonly resolved_dp_receipt_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F241_FEATURE_ID>;
}

export type F241DpCryptographicReceiptIssuerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F241_FEATURE_ID
>;

export const DEFAULT_F241_CONFIG: F241DpCryptographicReceiptIssuerConfig = {
  featureId: F241_FEATURE_ID,
  stage: F241_STAGE,
  operationCode: F241_OPERATION_CODE,
  contractVersion: F241_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F241DpCryptographicReceiptIssuerValidationError extends Error {
  public readonly featureId = F241_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F241 Validation Error on '${field}']: ${message}`);
    this.name = "F241DpCryptographicReceiptIssuerValidationError";
    this.field = field;
  }
}

export function computeF241Digest(rawPayload: string): string {
  return `f241_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F241DpCryptographicReceiptIssuerService extends KosmoraFeatureAdapterBase<
  typeof F241_FEATURE_ID,
  typeof F241_STAGE,
  typeof F241_OPERATION_CODE,
  F241DpCryptographicReceiptIssuerConfig,
  F241DpCryptographicReceiptIssuerInput,
  F241DpCryptographicReceiptIssuerOutput
> {
  constructor(
    customConfig?: Partial<F241DpCryptographicReceiptIssuerConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F241_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["query_id", "privatized_value", "remaining_epsilon", "dp_receipt_sha256"] as const,
      F241DpCryptographicReceiptIssuerValidationError
    );
  }
}

export function verifyF241Module(): {
  readonly featureId: typeof F241_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F241DpCryptographicReceiptIssuerService();
  const sampleInput: F241DpCryptographicReceiptIssuerInput = {
    requestId: "req_verify_f241",
    projectId: "proj_kosmora_f241",
    workspaceId: "ws_kosmora_f241",
    tenantId: "tenant_rlm_f241",
    actorId: "actor_verifier_f241",
    autonomyLevel: "A3",
    query_id: "seed_f241_query_id",
    privatized_value: 42,
    remaining_epsilon: true,
    dp_receipt_sha256: "seed_f241_dp_receipt_sha256",
    metadata: { stage: "stage8-finops-compliance", featureId: "F241" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F241" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_id !== sampleInput.query_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F241] Verification failed`);
  }

  return {
    featureId: F241_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
