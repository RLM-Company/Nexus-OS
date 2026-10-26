/**
 * F373 (stage12-homomorphic-vdf): Генератор узкоспециализированных макарунов минимальных привилегий для воркеров DAG
 * Ограничение мандата суб-агента только конкретным артефактом, операцией и лимитом стоимости
 * Operation Code: macaroon_subagent_scope
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

export const F373_FEATURE_ID = "F373" as const;
export const F373_STAGE = "stage12-homomorphic-vdf" as const;
export const F373_OPERATION_CODE = "macaroon_subagent_scope" as const;
export const F373_CONTRACT_VERSION = "2.0.0" as const;

export type F373MacaroonLeastPrivilegeSubagentScopedTokenConfig = BaseFeatureConfig<
  typeof F373_FEATURE_ID,
  typeof F373_STAGE,
  typeof F373_OPERATION_CODE
>;

export interface F373MacaroonLeastPrivilegeSubagentScopedTokenInput extends BaseFeatureInput {
  readonly worker_role: string | number | boolean | readonly string[];
  readonly bound_artifact_id: string | number | boolean | readonly string[];
  readonly max_cost_caveat: string | number | boolean | readonly string[];
  readonly token_verified: string | number | boolean | readonly string[];
}

export interface F373MacaroonLeastPrivilegeSubagentScopedTokenOutput {
  readonly featureId: typeof F373_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F373_OPERATION_CODE;
  readonly resolved_worker_role: unknown;
  readonly resolved_bound_artifact_id: unknown;
  readonly resolved_max_cost_caveat: unknown;
  readonly resolved_token_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F373_FEATURE_ID>;
}

export type F373MacaroonLeastPrivilegeSubagentScopedTokenTelemetrySnapshot = BaseFeatureTelemetry<typeof F373_FEATURE_ID>;

export const DEFAULT_F373_CONFIG: F373MacaroonLeastPrivilegeSubagentScopedTokenConfig = {
  featureId: F373_FEATURE_ID,
  stage: F373_STAGE,
  operationCode: F373_OPERATION_CODE,
  contractVersion: F373_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F373MacaroonLeastPrivilegeSubagentScopedTokenValidationError extends Error {
  public readonly featureId = F373_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F373 Validation Error on '${field}']: ${message}`);
    this.name = "F373MacaroonLeastPrivilegeSubagentScopedTokenValidationError";
    this.field = field;
  }
}

export function computeF373Digest(rawPayload: string): string {
  return `f373_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F373MacaroonLeastPrivilegeSubagentScopedTokenService extends KosmoraFeatureAdapterBase<
  typeof F373_FEATURE_ID,
  typeof F373_STAGE,
  typeof F373_OPERATION_CODE,
  F373MacaroonLeastPrivilegeSubagentScopedTokenConfig,
  F373MacaroonLeastPrivilegeSubagentScopedTokenInput,
  F373MacaroonLeastPrivilegeSubagentScopedTokenOutput
> {
  constructor(customConfig?: Partial<F373MacaroonLeastPrivilegeSubagentScopedTokenConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F373_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["worker_role", "bound_artifact_id", "max_cost_caveat", "token_verified"] as const,
      F373MacaroonLeastPrivilegeSubagentScopedTokenValidationError
    );
  }
}

export function verifyF373Module(): {
  readonly featureId: typeof F373_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F373MacaroonLeastPrivilegeSubagentScopedTokenService();
  const sampleInput: F373MacaroonLeastPrivilegeSubagentScopedTokenInput = {
    requestId: "req_verify_f373",
    projectId: "proj_kosmora_f373",
    workspaceId: "ws_kosmora_f373",
    tenantId: "tenant_rlm_f373",
    actorId: "actor_verifier_f373",
    autonomyLevel: "A3",
    worker_role: "seed_f373_worker_role",
    bound_artifact_id: 42,
    max_cost_caveat: true,
    token_verified: "seed_f373_token_verified",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F373" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F373" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_worker_role !== sampleInput.worker_role &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F373] Verification failed`);
  }

  return {
    featureId: F373_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
