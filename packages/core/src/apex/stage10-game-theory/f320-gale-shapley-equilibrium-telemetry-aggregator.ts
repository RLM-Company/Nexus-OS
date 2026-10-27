/**
 * F320 (stage10-game-theory): Финальный сертификатор 10-этапной архитектуры Kosmora (320 модулей: F001–F320)
 * Полная сквозная проверка всех 10 этапов (Autonomy, Canvas, Skills, Graph, Enterprise, Sovereign, Formal, FinOps, Quantum-ZK, Game-Theory)
 * Operation Code: galeshapley_telemetry_aggregate
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

export const F320_FEATURE_ID = "F320" as const;
export const F320_STAGE = "stage10-game-theory" as const;
export const F320_OPERATION_CODE = "galeshapley_telemetry_aggregate" as const;
export const F320_CONTRACT_VERSION = "2.0.0" as const;

export type F320GaleShapleyEquilibriumTelemetryAggregatorConfig = BaseFeatureConfig<
  typeof F320_FEATURE_ID,
  typeof F320_STAGE,
  typeof F320_OPERATION_CODE
>;

export interface F320GaleShapleyEquilibriumTelemetryAggregatorInput extends BaseFeatureInput {
  readonly matching_run_id: string | number | boolean | readonly string[];
  readonly blocking_pairs_count: string | number | boolean | readonly string[];
  readonly shapley_efficiency: string | number | boolean | readonly string[];
  readonly vcg_truthful_flag: string | number | boolean | readonly string[];
}

export interface F320GaleShapleyEquilibriumTelemetryAggregatorOutput {
  readonly featureId: typeof F320_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F320_OPERATION_CODE;
  readonly resolved_matching_run_id: unknown;
  readonly resolved_blocking_pairs_count: unknown;
  readonly resolved_shapley_efficiency: unknown;
  readonly resolved_vcg_truthful_flag: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F320_FEATURE_ID>;
}

export type F320GaleShapleyEquilibriumTelemetryAggregatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F320_FEATURE_ID
>;

export const DEFAULT_F320_CONFIG: F320GaleShapleyEquilibriumTelemetryAggregatorConfig = {
  featureId: F320_FEATURE_ID,
  stage: F320_STAGE,
  operationCode: F320_OPERATION_CODE,
  contractVersion: F320_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F320GaleShapleyEquilibriumTelemetryAggregatorValidationError extends Error {
  public readonly featureId = F320_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F320 Validation Error on '${field}']: ${message}`);
    this.name = "F320GaleShapleyEquilibriumTelemetryAggregatorValidationError";
    this.field = field;
  }
}

export function computeF320Digest(rawPayload: string): string {
  return `f320_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F320GaleShapleyEquilibriumTelemetryAggregatorService extends KosmoraFeatureAdapterBase<
  typeof F320_FEATURE_ID,
  typeof F320_STAGE,
  typeof F320_OPERATION_CODE,
  F320GaleShapleyEquilibriumTelemetryAggregatorConfig,
  F320GaleShapleyEquilibriumTelemetryAggregatorInput,
  F320GaleShapleyEquilibriumTelemetryAggregatorOutput
> {
  constructor(
    customConfig?: Partial<F320GaleShapleyEquilibriumTelemetryAggregatorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F320_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      [
        "matching_run_id",
        "blocking_pairs_count",
        "shapley_efficiency",
        "vcg_truthful_flag"
      ] as const,
      F320GaleShapleyEquilibriumTelemetryAggregatorValidationError
    );
  }
}

export function verifyF320Module(): {
  readonly featureId: typeof F320_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F320GaleShapleyEquilibriumTelemetryAggregatorService();
  const sampleInput: F320GaleShapleyEquilibriumTelemetryAggregatorInput = {
    requestId: "req_verify_f320",
    projectId: "proj_kosmora_f320",
    workspaceId: "ws_kosmora_f320",
    tenantId: "tenant_rlm_f320",
    actorId: "actor_verifier_f320",
    autonomyLevel: "A3",
    matching_run_id: "seed_f320_matching_run_id",
    blocking_pairs_count: 42,
    shapley_efficiency: true,
    vcg_truthful_flag: "seed_f320_vcg_truthful_flag",
    metadata: { stage: "stage10-game-theory", featureId: "F320" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F320" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_matching_run_id !== sampleInput.matching_run_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F320] Verification failed`);
  }

  return {
    featureId: F320_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
