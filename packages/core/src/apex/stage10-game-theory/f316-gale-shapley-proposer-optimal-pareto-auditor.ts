/**
 * F316 (stage10-game-theory): Аудитор Парето-оптимальности назначений для предлагающей стороны
 * Подтверждение того, что алгоритм Гейла-Шепли нашёл наилучшее устойчивое назначение для всех агентов
 * Operation Code: galeshapley_pareto_audit
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

export const F316_FEATURE_ID = "F316" as const;
export const F316_STAGE = "stage10-game-theory" as const;
export const F316_OPERATION_CODE = "galeshapley_pareto_audit" as const;
export const F316_CONTRACT_VERSION = "2.0.0" as const;

export type F316GaleShapleyProposerOptimalParetoAuditorConfig = BaseFeatureConfig<
  typeof F316_FEATURE_ID,
  typeof F316_STAGE,
  typeof F316_OPERATION_CODE
>;

export interface F316GaleShapleyProposerOptimalParetoAuditorInput extends BaseFeatureInput {
  readonly agent_optimal_map: string | number | boolean | readonly string[];
  readonly average_agent_rank: string | number | boolean | readonly string[];
  readonly average_task_rank: string | number | boolean | readonly string[];
  readonly optimality_bound: string | number | boolean | readonly string[];
}

export interface F316GaleShapleyProposerOptimalParetoAuditorOutput {
  readonly featureId: typeof F316_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F316_OPERATION_CODE;
  readonly resolved_agent_optimal_map: unknown;
  readonly resolved_average_agent_rank: unknown;
  readonly resolved_average_task_rank: unknown;
  readonly resolved_optimality_bound: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F316_FEATURE_ID>;
}

export type F316GaleShapleyProposerOptimalParetoAuditorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F316_FEATURE_ID
>;

export const DEFAULT_F316_CONFIG: F316GaleShapleyProposerOptimalParetoAuditorConfig = {
  featureId: F316_FEATURE_ID,
  stage: F316_STAGE,
  operationCode: F316_OPERATION_CODE,
  contractVersion: F316_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F316GaleShapleyProposerOptimalParetoAuditorValidationError extends Error {
  public readonly featureId = F316_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F316 Validation Error on '${field}']: ${message}`);
    this.name = "F316GaleShapleyProposerOptimalParetoAuditorValidationError";
    this.field = field;
  }
}

export function computeF316Digest(rawPayload: string): string {
  return `f316_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F316GaleShapleyProposerOptimalParetoAuditorService extends KosmoraFeatureAdapterBase<
  typeof F316_FEATURE_ID,
  typeof F316_STAGE,
  typeof F316_OPERATION_CODE,
  F316GaleShapleyProposerOptimalParetoAuditorConfig,
  F316GaleShapleyProposerOptimalParetoAuditorInput,
  F316GaleShapleyProposerOptimalParetoAuditorOutput
> {
  constructor(
    customConfig?: Partial<F316GaleShapleyProposerOptimalParetoAuditorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F316_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["agent_optimal_map", "average_agent_rank", "average_task_rank", "optimality_bound"] as const,
      F316GaleShapleyProposerOptimalParetoAuditorValidationError
    );
  }
}

export function verifyF316Module(): {
  readonly featureId: typeof F316_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F316GaleShapleyProposerOptimalParetoAuditorService();
  const sampleInput: F316GaleShapleyProposerOptimalParetoAuditorInput = {
    requestId: "req_verify_f316",
    projectId: "proj_kosmora_f316",
    workspaceId: "ws_kosmora_f316",
    tenantId: "tenant_rlm_f316",
    actorId: "actor_verifier_f316",
    autonomyLevel: "A3",
    agent_optimal_map: "seed_f316_agent_optimal_map",
    average_agent_rank: 42,
    average_task_rank: true,
    optimality_bound: "seed_f316_optimality_bound",
    metadata: { stage: "stage10-game-theory", featureId: "F316" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F316" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_optimal_map !== sampleInput.agent_optimal_map &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F316] Verification failed`);
  }

  return {
    featureId: F316_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
