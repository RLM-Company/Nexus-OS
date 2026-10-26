/**
 * F230 (stage8-finops-compliance): Обновитель апостериорной статистики вознаграждений бандита в реальном времени
 * Пересчёт весов успешности и EWMA-латентности после каждого завершённого вызова LLM
 * Operation Code: bandit_telemetry_posterior_updater
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

export const F230_FEATURE_ID = "F230" as const;
export const F230_STAGE = "stage8-finops-compliance" as const;
export const F230_OPERATION_CODE = "bandit_telemetry_posterior_updater" as const;
export const F230_CONTRACT_VERSION = "2.0.0" as const;

export type F230BanditTelemetryPosteriorUpdaterConfig = BaseFeatureConfig<
  typeof F230_FEATURE_ID,
  typeof F230_STAGE,
  typeof F230_OPERATION_CODE
>;

export interface F230BanditTelemetryPosteriorUpdaterInput extends BaseFeatureInput {
  readonly provider_id: string | number | boolean | readonly string[];
  readonly total_pulls: string | number | boolean | readonly string[];
  readonly empirical_win_rate: string | number | boolean | readonly string[];
  readonly ewma_latency_ms: string | number | boolean | readonly string[];
}

export interface F230BanditTelemetryPosteriorUpdaterOutput {
  readonly featureId: typeof F230_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F230_OPERATION_CODE;
  readonly resolved_provider_id: unknown;
  readonly resolved_total_pulls: unknown;
  readonly resolved_empirical_win_rate: unknown;
  readonly resolved_ewma_latency_ms: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F230_FEATURE_ID>;
}

export type F230BanditTelemetryPosteriorUpdaterTelemetrySnapshot = BaseFeatureTelemetry<typeof F230_FEATURE_ID>;

export const DEFAULT_F230_CONFIG: F230BanditTelemetryPosteriorUpdaterConfig = {
  featureId: F230_FEATURE_ID,
  stage: F230_STAGE,
  operationCode: F230_OPERATION_CODE,
  contractVersion: F230_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F230BanditTelemetryPosteriorUpdaterValidationError extends Error {
  public readonly featureId = F230_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F230 Validation Error on '${field}']: ${message}`);
    this.name = "F230BanditTelemetryPosteriorUpdaterValidationError";
    this.field = field;
  }
}

export function computeF230Digest(rawPayload: string): string {
  return `f230_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F230BanditTelemetryPosteriorUpdaterService extends KosmoraFeatureAdapterBase<
  typeof F230_FEATURE_ID,
  typeof F230_STAGE,
  typeof F230_OPERATION_CODE,
  F230BanditTelemetryPosteriorUpdaterConfig,
  F230BanditTelemetryPosteriorUpdaterInput,
  F230BanditTelemetryPosteriorUpdaterOutput
> {
  constructor(customConfig?: Partial<F230BanditTelemetryPosteriorUpdaterConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F230_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["provider_id", "total_pulls", "empirical_win_rate", "ewma_latency_ms"] as const,
      F230BanditTelemetryPosteriorUpdaterValidationError
    );
  }
}

export function verifyF230Module(): {
  readonly featureId: typeof F230_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F230BanditTelemetryPosteriorUpdaterService();
  const sampleInput: F230BanditTelemetryPosteriorUpdaterInput = {
    requestId: "req_verify_f230",
    projectId: "proj_kosmora_f230",
    workspaceId: "ws_kosmora_f230",
    tenantId: "tenant_rlm_f230",
    actorId: "actor_verifier_f230",
    autonomyLevel: "A3",
    provider_id: "seed_f230_provider_id",
    total_pulls: 42,
    empirical_win_rate: true,
    ewma_latency_ms: "seed_f230_ewma_latency_ms",
    metadata: { stage: "stage8-finops-compliance", featureId: "F230" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F230" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_provider_id !== sampleInput.provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F230] Verification failed`);
  }

  return {
    featureId: F230_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
