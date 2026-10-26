/**
 * F229 (stage8-finops-compliance): Планировщик калибровочных запросов (Cold-Start Exploration) для новых моделей
 * Гарантированное выделение тестового трафика новым подключённым моделям для набора статистики
 * Operation Code: cold_start_provider_exploration_scheduler
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

export const F229_FEATURE_ID = "F229" as const;
export const F229_STAGE = "stage8-finops-compliance" as const;
export const F229_OPERATION_CODE = "cold_start_provider_exploration_scheduler" as const;
export const F229_CONTRACT_VERSION = "2.0.0" as const;

export type F229ColdStartProviderExplorationSchedulerConfig = BaseFeatureConfig<
  typeof F229_FEATURE_ID,
  typeof F229_STAGE,
  typeof F229_OPERATION_CODE
>;

export interface F229ColdStartProviderExplorationSchedulerInput extends BaseFeatureInput {
  readonly explored_provider_id: string | number | boolean | readonly string[];
  readonly total_pulls: string | number | boolean | readonly string[];
  readonly exploration_bonus: string | number | boolean | readonly string[];
  readonly routing_digest: string | number | boolean | readonly string[];
}

export interface F229ColdStartProviderExplorationSchedulerOutput {
  readonly featureId: typeof F229_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F229_OPERATION_CODE;
  readonly resolved_explored_provider_id: unknown;
  readonly resolved_total_pulls: unknown;
  readonly resolved_exploration_bonus: unknown;
  readonly resolved_routing_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F229_FEATURE_ID>;
}

export type F229ColdStartProviderExplorationSchedulerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F229_FEATURE_ID
>;

export const DEFAULT_F229_CONFIG: F229ColdStartProviderExplorationSchedulerConfig = {
  featureId: F229_FEATURE_ID,
  stage: F229_STAGE,
  operationCode: F229_OPERATION_CODE,
  contractVersion: F229_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F229ColdStartProviderExplorationSchedulerValidationError extends Error {
  public readonly featureId = F229_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F229 Validation Error on '${field}']: ${message}`);
    this.name = "F229ColdStartProviderExplorationSchedulerValidationError";
    this.field = field;
  }
}

export function computeF229Digest(rawPayload: string): string {
  return `f229_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F229ColdStartProviderExplorationSchedulerService extends KosmoraFeatureAdapterBase<
  typeof F229_FEATURE_ID,
  typeof F229_STAGE,
  typeof F229_OPERATION_CODE,
  F229ColdStartProviderExplorationSchedulerConfig,
  F229ColdStartProviderExplorationSchedulerInput,
  F229ColdStartProviderExplorationSchedulerOutput
> {
  constructor(
    customConfig?: Partial<F229ColdStartProviderExplorationSchedulerConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F229_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["explored_provider_id", "total_pulls", "exploration_bonus", "routing_digest"] as const,
      F229ColdStartProviderExplorationSchedulerValidationError
    );
  }
}

export function verifyF229Module(): {
  readonly featureId: typeof F229_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F229ColdStartProviderExplorationSchedulerService();
  const sampleInput: F229ColdStartProviderExplorationSchedulerInput = {
    requestId: "req_verify_f229",
    projectId: "proj_kosmora_f229",
    workspaceId: "ws_kosmora_f229",
    tenantId: "tenant_rlm_f229",
    actorId: "actor_verifier_f229",
    autonomyLevel: "A3",
    explored_provider_id: "seed_f229_explored_provider_id",
    total_pulls: 42,
    exploration_bonus: true,
    routing_digest: "seed_f229_routing_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F229" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F229" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_explored_provider_id !== sampleInput.explored_provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F229] Verification failed`);
  }

  return {
    featureId: F229_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
