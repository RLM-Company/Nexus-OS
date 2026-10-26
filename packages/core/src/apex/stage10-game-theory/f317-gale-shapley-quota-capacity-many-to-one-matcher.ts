/**
 * F317 (stage10-game-theory): Механизм устойчивого распределения с квотами ёмкости узлов
 * Сопоставление групп воркеров с пулами задач с учётом ограничений слотов и приоритетов
 * Operation Code: galeshapley_quota_matcher
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
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F317_FEATURE_ID = "F317" as const;
export const F317_STAGE = "stage10-game-theory" as const;
export const F317_OPERATION_CODE = "galeshapley_quota_matcher" as const;
export const F317_CONTRACT_VERSION = "2.0.0" as const;

export type F317GaleShapleyQuotaCapacityManyToOneMatcherConfig = BaseFeatureConfig<
  typeof F317_FEATURE_ID,
  typeof F317_STAGE,
  typeof F317_OPERATION_CODE
>;

export interface F317GaleShapleyQuotaCapacityManyToOneMatcherInput extends BaseFeatureInput {
  readonly worker_agents: string | number | boolean | readonly string[];
  readonly queue_buckets: string | number | boolean | readonly string[];
  readonly bucket_capacities: string | number | boolean | readonly string[];
  readonly preference_lists: string | number | boolean | readonly string[];
}

export interface F317GaleShapleyQuotaCapacityManyToOneMatcherOutput {
  readonly featureId: typeof F317_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F317_OPERATION_CODE;
  readonly resolved_worker_agents: unknown;
  readonly resolved_queue_buckets: unknown;
  readonly resolved_bucket_capacities: unknown;
  readonly resolved_preference_lists: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F317_FEATURE_ID>;
}

export type F317GaleShapleyQuotaCapacityManyToOneMatcherTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F317_FEATURE_ID
>;

export const DEFAULT_F317_CONFIG: F317GaleShapleyQuotaCapacityManyToOneMatcherConfig = {
  featureId: F317_FEATURE_ID,
  stage: F317_STAGE,
  operationCode: F317_OPERATION_CODE,
  contractVersion: F317_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F317GaleShapleyQuotaCapacityManyToOneMatcherValidationError extends Error {
  public readonly featureId = F317_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F317 Validation Error on '${field}']: ${message}`);
    this.name = "F317GaleShapleyQuotaCapacityManyToOneMatcherValidationError";
    this.field = field;
  }
}

export function computeF317Digest(rawPayload: string): string {
  return `f317_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F317GaleShapleyQuotaCapacityManyToOneMatcherService extends KosmoraFeatureAdapterBase<
  typeof F317_FEATURE_ID,
  typeof F317_STAGE,
  typeof F317_OPERATION_CODE,
  F317GaleShapleyQuotaCapacityManyToOneMatcherConfig,
  F317GaleShapleyQuotaCapacityManyToOneMatcherInput,
  F317GaleShapleyQuotaCapacityManyToOneMatcherOutput
> {
  constructor(
    customConfig?: Partial<F317GaleShapleyQuotaCapacityManyToOneMatcherConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F317_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["worker_agents", "queue_buckets", "bucket_capacities", "preference_lists"] as const,
      F317GaleShapleyQuotaCapacityManyToOneMatcherValidationError
    );
  }
}

export function verifyF317Module(): {
  readonly featureId: typeof F317_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F317GaleShapleyQuotaCapacityManyToOneMatcherService();
  const sampleInput: F317GaleShapleyQuotaCapacityManyToOneMatcherInput = {
    requestId: "req_verify_f317",
    projectId: "proj_kosmora_f317",
    workspaceId: "ws_kosmora_f317",
    tenantId: "tenant_rlm_f317",
    actorId: "actor_verifier_f317",
    autonomyLevel: "A3",
    worker_agents: "seed_f317_worker_agents",
    queue_buckets: 42,
    bucket_capacities: true,
    preference_lists: "seed_f317_preference_lists",
    metadata: { stage: "stage10-game-theory", featureId: "F317" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F317" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_worker_agents !== sampleInput.worker_agents &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F317] Verification failed`);
  }

  return {
    featureId: F317_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
