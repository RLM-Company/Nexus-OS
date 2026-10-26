/**
 * F374 (stage12-homomorphic-vdf): Контроллер временных ограничений жизни мандата (ttl_epoch <= limit)
 * Автоматическая инвалидация делегированного макаруна по истечении окна выполнения узла
 * Operation Code: macaroon_ttl_enforcer
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

export const F374_FEATURE_ID = "F374" as const;
export const F374_STAGE = "stage12-homomorphic-vdf" as const;
export const F374_OPERATION_CODE = "macaroon_ttl_enforcer" as const;
export const F374_CONTRACT_VERSION = "2.0.0" as const;

export type F374MacaroonTimeBoundedTtlExpirationEnforcerConfig = BaseFeatureConfig<
  typeof F374_FEATURE_ID,
  typeof F374_STAGE,
  typeof F374_OPERATION_CODE
>;

export interface F374MacaroonTimeBoundedTtlExpirationEnforcerInput extends BaseFeatureInput {
  readonly macaroon_id: string | number | boolean | readonly string[];
  readonly current_epoch: string | number | boolean | readonly string[];
  readonly expiry_limit: string | number | boolean | readonly string[];
  readonly ttl_valid: string | number | boolean | readonly string[];
}

export interface F374MacaroonTimeBoundedTtlExpirationEnforcerOutput {
  readonly featureId: typeof F374_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F374_OPERATION_CODE;
  readonly resolved_macaroon_id: unknown;
  readonly resolved_current_epoch: unknown;
  readonly resolved_expiry_limit: unknown;
  readonly resolved_ttl_valid: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F374_FEATURE_ID>;
}

export type F374MacaroonTimeBoundedTtlExpirationEnforcerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F374_FEATURE_ID
>;

export const DEFAULT_F374_CONFIG: F374MacaroonTimeBoundedTtlExpirationEnforcerConfig = {
  featureId: F374_FEATURE_ID,
  stage: F374_STAGE,
  operationCode: F374_OPERATION_CODE,
  contractVersion: F374_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F374MacaroonTimeBoundedTtlExpirationEnforcerValidationError extends Error {
  public readonly featureId = F374_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F374 Validation Error on '${field}']: ${message}`);
    this.name = "F374MacaroonTimeBoundedTtlExpirationEnforcerValidationError";
    this.field = field;
  }
}

export function computeF374Digest(rawPayload: string): string {
  return `f374_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F374MacaroonTimeBoundedTtlExpirationEnforcerService extends KosmoraFeatureAdapterBase<
  typeof F374_FEATURE_ID,
  typeof F374_STAGE,
  typeof F374_OPERATION_CODE,
  F374MacaroonTimeBoundedTtlExpirationEnforcerConfig,
  F374MacaroonTimeBoundedTtlExpirationEnforcerInput,
  F374MacaroonTimeBoundedTtlExpirationEnforcerOutput
> {
  constructor(
    customConfig?: Partial<F374MacaroonTimeBoundedTtlExpirationEnforcerConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F374_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["macaroon_id", "current_epoch", "expiry_limit", "ttl_valid"] as const,
      F374MacaroonTimeBoundedTtlExpirationEnforcerValidationError
    );
  }
}

export function verifyF374Module(): {
  readonly featureId: typeof F374_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F374MacaroonTimeBoundedTtlExpirationEnforcerService();
  const sampleInput: F374MacaroonTimeBoundedTtlExpirationEnforcerInput = {
    requestId: "req_verify_f374",
    projectId: "proj_kosmora_f374",
    workspaceId: "ws_kosmora_f374",
    tenantId: "tenant_rlm_f374",
    actorId: "actor_verifier_f374",
    autonomyLevel: "A3",
    macaroon_id: "seed_f374_macaroon_id",
    current_epoch: 42,
    expiry_limit: true,
    ttl_valid: "seed_f374_ttl_valid",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F374" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F374" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_macaroon_id !== sampleInput.macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F374] Verification failed`);
  }

  return {
    featureId: F374_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
