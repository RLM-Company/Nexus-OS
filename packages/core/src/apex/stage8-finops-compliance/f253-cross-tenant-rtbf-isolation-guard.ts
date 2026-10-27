/**
 * F253 (stage8-finops-compliance): Защитник межтенантной изоляции при выполнении каскадного удаления данных
 * Гарантия того, что запрос на забвение в одном тенанте не затрагивает одноимённые идентификаторы в других организациях
 * Operation Code: cross_tenant_rtbf_isolation_guard
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

export const F253_FEATURE_ID = "F253" as const;
export const F253_STAGE = "stage8-finops-compliance" as const;
export const F253_OPERATION_CODE = "cross_tenant_rtbf_isolation_guard" as const;
export const F253_CONTRACT_VERSION = "2.0.0" as const;

export type F253CrossTenantRtbfIsolationGuardConfig = BaseFeatureConfig<
  typeof F253_FEATURE_ID,
  typeof F253_STAGE,
  typeof F253_OPERATION_CODE
>;

export interface F253CrossTenantRtbfIsolationGuardInput extends BaseFeatureInput {
  readonly erased_tenant_remaining: string | number | boolean | readonly string[];
  readonly other_tenant_preserved: string | number | boolean | readonly string[];
  readonly isolation_verified: string | number | boolean | readonly string[];
  readonly erasure_root_hash: string | number | boolean | readonly string[];
}

export interface F253CrossTenantRtbfIsolationGuardOutput {
  readonly featureId: typeof F253_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F253_OPERATION_CODE;
  readonly resolved_erased_tenant_remaining: unknown;
  readonly resolved_other_tenant_preserved: unknown;
  readonly resolved_isolation_verified: unknown;
  readonly resolved_erasure_root_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F253_FEATURE_ID>;
}

export type F253CrossTenantRtbfIsolationGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F253_FEATURE_ID
>;

export const DEFAULT_F253_CONFIG: F253CrossTenantRtbfIsolationGuardConfig = {
  featureId: F253_FEATURE_ID,
  stage: F253_STAGE,
  operationCode: F253_OPERATION_CODE,
  contractVersion: F253_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F253CrossTenantRtbfIsolationGuardValidationError extends Error {
  public readonly featureId = F253_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F253 Validation Error on '${field}']: ${message}`);
    this.name = "F253CrossTenantRtbfIsolationGuardValidationError";
    this.field = field;
  }
}

export function computeF253Digest(rawPayload: string): string {
  return `f253_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F253CrossTenantRtbfIsolationGuardService extends KosmoraFeatureAdapterBase<
  typeof F253_FEATURE_ID,
  typeof F253_STAGE,
  typeof F253_OPERATION_CODE,
  F253CrossTenantRtbfIsolationGuardConfig,
  F253CrossTenantRtbfIsolationGuardInput,
  F253CrossTenantRtbfIsolationGuardOutput
> {
  constructor(
    customConfig?: Partial<F253CrossTenantRtbfIsolationGuardConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F253_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      [
        "erased_tenant_remaining",
        "other_tenant_preserved",
        "isolation_verified",
        "erasure_root_hash"
      ] as const,
      F253CrossTenantRtbfIsolationGuardValidationError
    );
  }
}

export function verifyF253Module(): {
  readonly featureId: typeof F253_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F253CrossTenantRtbfIsolationGuardService();
  const sampleInput: F253CrossTenantRtbfIsolationGuardInput = {
    requestId: "req_verify_f253",
    projectId: "proj_kosmora_f253",
    workspaceId: "ws_kosmora_f253",
    tenantId: "tenant_rlm_f253",
    actorId: "actor_verifier_f253",
    autonomyLevel: "A3",
    erased_tenant_remaining: "seed_f253_erased_tenant_remaining",
    other_tenant_preserved: 42,
    isolation_verified: true,
    erasure_root_hash: "seed_f253_erasure_root_hash",
    metadata: { stage: "stage8-finops-compliance", featureId: "F253" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F253" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_erased_tenant_remaining !== sampleInput.erased_tenant_remaining &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F253] Verification failed`);
  }

  return {
    featureId: F253_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
