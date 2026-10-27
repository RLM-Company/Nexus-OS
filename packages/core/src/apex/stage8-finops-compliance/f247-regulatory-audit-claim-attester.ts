/**
 * F247 (stage8-finops-compliance): Аттестатор регуляторных требований (GDPR / 152-ФЗ / SOC2) через селективное раскрытие
 * Подтверждение статуса прохождения проверок безопасности без публикации внутренних логов компании
 * Operation Code: regulatory_audit_claim_attester
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

export const F247_FEATURE_ID = "F247" as const;
export const F247_STAGE = "stage8-finops-compliance" as const;
export const F247_OPERATION_CODE = "regulatory_audit_claim_attester" as const;
export const F247_CONTRACT_VERSION = "2.0.0" as const;

export type F247RegulatoryAuditClaimAttesterConfig = BaseFeatureConfig<
  typeof F247_FEATURE_ID,
  typeof F247_STAGE,
  typeof F247_OPERATION_CODE
>;

export interface F247RegulatoryAuditClaimAttesterInput extends BaseFeatureInput {
  readonly claim_key: string | number | boolean | readonly string[];
  readonly claim_value: string | number | boolean | readonly string[];
  readonly merkle_root: string | number | boolean | readonly string[];
  readonly verified: string | number | boolean | readonly string[];
}

export interface F247RegulatoryAuditClaimAttesterOutput {
  readonly featureId: typeof F247_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F247_OPERATION_CODE;
  readonly resolved_claim_key: unknown;
  readonly resolved_claim_value: unknown;
  readonly resolved_merkle_root: unknown;
  readonly resolved_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F247_FEATURE_ID>;
}

export type F247RegulatoryAuditClaimAttesterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F247_FEATURE_ID
>;

export const DEFAULT_F247_CONFIG: F247RegulatoryAuditClaimAttesterConfig = {
  featureId: F247_FEATURE_ID,
  stage: F247_STAGE,
  operationCode: F247_OPERATION_CODE,
  contractVersion: F247_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F247RegulatoryAuditClaimAttesterValidationError extends Error {
  public readonly featureId = F247_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F247 Validation Error on '${field}']: ${message}`);
    this.name = "F247RegulatoryAuditClaimAttesterValidationError";
    this.field = field;
  }
}

export function computeF247Digest(rawPayload: string): string {
  return `f247_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F247RegulatoryAuditClaimAttesterService extends KosmoraFeatureAdapterBase<
  typeof F247_FEATURE_ID,
  typeof F247_STAGE,
  typeof F247_OPERATION_CODE,
  F247RegulatoryAuditClaimAttesterConfig,
  F247RegulatoryAuditClaimAttesterInput,
  F247RegulatoryAuditClaimAttesterOutput
> {
  constructor(
    customConfig?: Partial<F247RegulatoryAuditClaimAttesterConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F247_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["claim_key", "claim_value", "merkle_root", "verified"] as const,
      F247RegulatoryAuditClaimAttesterValidationError
    );
  }
}

export function verifyF247Module(): {
  readonly featureId: typeof F247_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F247RegulatoryAuditClaimAttesterService();
  const sampleInput: F247RegulatoryAuditClaimAttesterInput = {
    requestId: "req_verify_f247",
    projectId: "proj_kosmora_f247",
    workspaceId: "ws_kosmora_f247",
    tenantId: "tenant_rlm_f247",
    actorId: "actor_verifier_f247",
    autonomyLevel: "A3",
    claim_key: "seed_f247_claim_key",
    claim_value: 42,
    merkle_root: true,
    verified: "seed_f247_verified",
    metadata: { stage: "stage8-finops-compliance", featureId: "F247" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F247" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_claim_key !== sampleInput.claim_key &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F247] Verification failed`);
  }

  return {
    featureId: F247_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
