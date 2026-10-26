/**
 * F204 (stage7-formal-verification): Экспортер детерминированной матрицы назначений задач на узлы
 * Формирование верифицированного плана распределения воркеров с криптографическим дайджестом
 * Operation Code: deterministic_placement_matrix_exporter
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F204_FEATURE_ID = "F204" as const;
export const F204_STAGE = "stage7-formal-verification" as const;
export const F204_OPERATION_CODE = "deterministic_placement_matrix_exporter" as const;
export const F204_CONTRACT_VERSION = "2.0.0" as const;

export type F204DeterministicPlacementMatrixExporterConfig = BaseFeatureConfig<
  typeof F204_FEATURE_ID,
  typeof F204_STAGE,
  typeof F204_OPERATION_CODE
>;

export interface F204DeterministicPlacementMatrixExporterInput extends BaseFeatureInput {
  readonly assignments_count: string | number | boolean | readonly string[];
  readonly schedule_digest: string | number | boolean | readonly string[];
  readonly total_cost_usd: string | number | boolean | readonly string[];
  readonly ready_for_dispatch: string | number | boolean | readonly string[];
}

export interface F204DeterministicPlacementMatrixExporterOutput {
  readonly featureId: typeof F204_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F204_OPERATION_CODE;
  readonly resolved_assignments_count: unknown;
  readonly resolved_schedule_digest: unknown;
  readonly resolved_total_cost_usd: unknown;
  readonly resolved_ready_for_dispatch: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F204_FEATURE_ID>;
}

export type F204DeterministicPlacementMatrixExporterTelemetrySnapshot = BaseFeatureTelemetry<typeof F204_FEATURE_ID>;

export const DEFAULT_F204_CONFIG: F204DeterministicPlacementMatrixExporterConfig = {
  featureId: F204_FEATURE_ID,
  stage: F204_STAGE,
  operationCode: F204_OPERATION_CODE,
  contractVersion: F204_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F204DeterministicPlacementMatrixExporterValidationError extends Error {
  public readonly featureId = F204_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F204 Validation Error on '${field}']: ${message}`);
    this.name = "F204DeterministicPlacementMatrixExporterValidationError";
    this.field = field;
  }
}

export function computeF204Digest(rawPayload: string): string {
  return `f204_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F204DeterministicPlacementMatrixExporterService extends KosmoraFeatureAdapterBase<
  typeof F204_FEATURE_ID,
  typeof F204_STAGE,
  typeof F204_OPERATION_CODE,
  F204DeterministicPlacementMatrixExporterConfig,
  F204DeterministicPlacementMatrixExporterInput,
  F204DeterministicPlacementMatrixExporterOutput
> {
  constructor(customConfig?: Partial<F204DeterministicPlacementMatrixExporterConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F204_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["assignments_count", "schedule_digest", "total_cost_usd", "ready_for_dispatch"] as const,
      F204DeterministicPlacementMatrixExporterValidationError
    );
  }
}

export function verifyF204Module(): {
  readonly featureId: typeof F204_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F204DeterministicPlacementMatrixExporterService();
  const sampleInput: F204DeterministicPlacementMatrixExporterInput = {
    requestId: "req_verify_f204",
    projectId: "proj_kosmora_f204",
    workspaceId: "ws_kosmora_f204",
    tenantId: "tenant_rlm_f204",
    actorId: "actor_verifier_f204",
    autonomyLevel: "A3",
    assignments_count: "seed_f204_assignments_count",
    schedule_digest: 42,
    total_cost_usd: true,
    ready_for_dispatch: "seed_f204_ready_for_dispatch",
    metadata: { stage: "stage7-formal-verification", featureId: "F204" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F204" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_assignments_count !== sampleInput.assignments_count &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F204] Verification failed`);
  }

  return {
    featureId: F204_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
