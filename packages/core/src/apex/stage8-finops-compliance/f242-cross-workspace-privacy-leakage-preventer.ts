/**
 * F242 (stage8-finops-compliance): Изолятор бюджетов приватности между независимыми воркспейсами и тенантами
 * Гарантия невозможности использования бюджета приватности одного проекта для запросов к другому
 * Operation Code: cross_workspace_privacy_leakage_preventer
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

export const F242_FEATURE_ID = "F242" as const;
export const F242_STAGE = "stage8-finops-compliance" as const;
export const F242_OPERATION_CODE = "cross_workspace_privacy_leakage_preventer" as const;
export const F242_CONTRACT_VERSION = "2.0.0" as const;

export type F242CrossWorkspacePrivacyLeakagePreventerConfig = BaseFeatureConfig<
  typeof F242_FEATURE_ID,
  typeof F242_STAGE,
  typeof F242_OPERATION_CODE
>;

export interface F242CrossWorkspacePrivacyLeakagePreventerInput extends BaseFeatureInput {
  readonly tenant_a_remaining_eps: string | number | boolean | readonly string[];
  readonly tenant_b_remaining_eps: string | number | boolean | readonly string[];
  readonly isolation_intact: string | number | boolean | readonly string[];
  readonly receipt_digest: string | number | boolean | readonly string[];
}

export interface F242CrossWorkspacePrivacyLeakagePreventerOutput {
  readonly featureId: typeof F242_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F242_OPERATION_CODE;
  readonly resolved_tenant_a_remaining_eps: unknown;
  readonly resolved_tenant_b_remaining_eps: unknown;
  readonly resolved_isolation_intact: unknown;
  readonly resolved_receipt_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F242_FEATURE_ID>;
}

export type F242CrossWorkspacePrivacyLeakagePreventerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F242_FEATURE_ID
>;

export const DEFAULT_F242_CONFIG: F242CrossWorkspacePrivacyLeakagePreventerConfig = {
  featureId: F242_FEATURE_ID,
  stage: F242_STAGE,
  operationCode: F242_OPERATION_CODE,
  contractVersion: F242_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F242CrossWorkspacePrivacyLeakagePreventerValidationError extends Error {
  public readonly featureId = F242_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F242 Validation Error on '${field}']: ${message}`);
    this.name = "F242CrossWorkspacePrivacyLeakagePreventerValidationError";
    this.field = field;
  }
}

export function computeF242Digest(rawPayload: string): string {
  return `f242_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F242CrossWorkspacePrivacyLeakagePreventerService extends KosmoraFeatureAdapterBase<
  typeof F242_FEATURE_ID,
  typeof F242_STAGE,
  typeof F242_OPERATION_CODE,
  F242CrossWorkspacePrivacyLeakagePreventerConfig,
  F242CrossWorkspacePrivacyLeakagePreventerInput,
  F242CrossWorkspacePrivacyLeakagePreventerOutput
> {
  constructor(
    customConfig?: Partial<F242CrossWorkspacePrivacyLeakagePreventerConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F242_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      [
        "tenant_a_remaining_eps",
        "tenant_b_remaining_eps",
        "isolation_intact",
        "receipt_digest"
      ] as const,
      F242CrossWorkspacePrivacyLeakagePreventerValidationError
    );
  }
}

export function verifyF242Module(): {
  readonly featureId: typeof F242_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F242CrossWorkspacePrivacyLeakagePreventerService();
  const sampleInput: F242CrossWorkspacePrivacyLeakagePreventerInput = {
    requestId: "req_verify_f242",
    projectId: "proj_kosmora_f242",
    workspaceId: "ws_kosmora_f242",
    tenantId: "tenant_rlm_f242",
    actorId: "actor_verifier_f242",
    autonomyLevel: "A3",
    tenant_a_remaining_eps: "seed_f242_tenant_a_remaining_eps",
    tenant_b_remaining_eps: 42,
    isolation_intact: true,
    receipt_digest: "seed_f242_receipt_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F242" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F242" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_a_remaining_eps !== sampleInput.tenant_a_remaining_eps &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F242] Verification failed`);
  }

  return {
    featureId: F242_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
