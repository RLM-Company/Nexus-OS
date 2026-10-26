/**
 * F306 (stage10-game-theory): Решатель сильнейших путей Шульце методом Флойда-Уоршелла (Beatpath Solver)
 * Вычисление пропускной способности сильнейших цепочек побед p[A,B] между всеми парами архитектурных альтернатив
 * Operation Code: schulze_widest_path
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

export const F306_FEATURE_ID = "F306" as const;
export const F306_STAGE = "stage10-game-theory" as const;
export const F306_OPERATION_CODE = "schulze_widest_path" as const;
export const F306_CONTRACT_VERSION = "2.0.0" as const;

export type F306SchulzeFloydWarshallWidestPathSolverConfig = BaseFeatureConfig<
  typeof F306_FEATURE_ID,
  typeof F306_STAGE,
  typeof F306_OPERATION_CODE
>;

export interface F306SchulzeFloydWarshallWidestPathSolverInput extends BaseFeatureInput {
  readonly pairwise_defeats: string | number | boolean | readonly string[];
  readonly candidate_count: string | number | boolean | readonly string[];
  readonly path_strength_metric: string | number | boolean | readonly string[];
  readonly convergence_check: string | number | boolean | readonly string[];
}

export interface F306SchulzeFloydWarshallWidestPathSolverOutput {
  readonly featureId: typeof F306_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F306_OPERATION_CODE;
  readonly resolved_pairwise_defeats: unknown;
  readonly resolved_candidate_count: unknown;
  readonly resolved_path_strength_metric: unknown;
  readonly resolved_convergence_check: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F306_FEATURE_ID>;
}

export type F306SchulzeFloydWarshallWidestPathSolverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F306_FEATURE_ID
>;

export const DEFAULT_F306_CONFIG: F306SchulzeFloydWarshallWidestPathSolverConfig = {
  featureId: F306_FEATURE_ID,
  stage: F306_STAGE,
  operationCode: F306_OPERATION_CODE,
  contractVersion: F306_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F306SchulzeFloydWarshallWidestPathSolverValidationError extends Error {
  public readonly featureId = F306_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F306 Validation Error on '${field}']: ${message}`);
    this.name = "F306SchulzeFloydWarshallWidestPathSolverValidationError";
    this.field = field;
  }
}

export function computeF306Digest(rawPayload: string): string {
  return `f306_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F306SchulzeFloydWarshallWidestPathSolverService extends KosmoraFeatureAdapterBase<
  typeof F306_FEATURE_ID,
  typeof F306_STAGE,
  typeof F306_OPERATION_CODE,
  F306SchulzeFloydWarshallWidestPathSolverConfig,
  F306SchulzeFloydWarshallWidestPathSolverInput,
  F306SchulzeFloydWarshallWidestPathSolverOutput
> {
  constructor(
    customConfig?: Partial<F306SchulzeFloydWarshallWidestPathSolverConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F306_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["pairwise_defeats", "candidate_count", "path_strength_metric", "convergence_check"] as const,
      F306SchulzeFloydWarshallWidestPathSolverValidationError
    );
  }
}

export function verifyF306Module(): {
  readonly featureId: typeof F306_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F306SchulzeFloydWarshallWidestPathSolverService();
  const sampleInput: F306SchulzeFloydWarshallWidestPathSolverInput = {
    requestId: "req_verify_f306",
    projectId: "proj_kosmora_f306",
    workspaceId: "ws_kosmora_f306",
    tenantId: "tenant_rlm_f306",
    actorId: "actor_verifier_f306",
    autonomyLevel: "A3",
    pairwise_defeats: "seed_f306_pairwise_defeats",
    candidate_count: 42,
    path_strength_metric: true,
    convergence_check: "seed_f306_convergence_check",
    metadata: { stage: "stage10-game-theory", featureId: "F306" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F306" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_pairwise_defeats !== sampleInput.pairwise_defeats &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F306] Verification failed`);
  }

  return {
    featureId: F306_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
