import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage15TopologicalPersistenceKernel } from "./stage-kernel.js";

export const F450_FEATURE_ID = "F450" as const;
export const F450_STAGE = "stage15-topological-persistence" as const;
export const F450_OPERATION_CODE = "F450_GF2_BOUNDARY_MATRIX_GAUSSIAN_RANK_SOLVER" as const;
export const F450_CONTRACT_VERSION = "2.0.0" as const;

export type F450Gf2BoundaryMatrixGaussianRankSolverConfig = BaseFeatureConfig<
  typeof F450_FEATURE_ID,
  typeof F450_STAGE,
  typeof F450_OPERATION_CODE
>;

export interface F450Gf2BoundaryMatrixGaussianRankSolverInput extends BaseFeatureInput {
  readonly boundary_matrix_b1: string | number | boolean | readonly string[];
  readonly boundary_matrix_b2: string | number | boolean | readonly string[];
  readonly field_modulus_p: string | number | boolean | readonly string[];
  readonly pivot_strategy: string | number | boolean | readonly string[];
}

export interface F450Gf2BoundaryMatrixGaussianRankSolverOutput {
  readonly featureId: typeof F450_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F450_OPERATION_CODE;
  readonly resolved_boundary_matrix_b1: unknown;
  readonly resolved_boundary_matrix_b2: unknown;
  readonly resolved_field_modulus_p: unknown;
  readonly resolved_pivot_strategy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F450_FEATURE_ID>;
}

export type F450Gf2BoundaryMatrixGaussianRankSolverTelemetrySnapshot = BaseFeatureTelemetry<typeof F450_FEATURE_ID>;

export const DEFAULT_F450_CONFIG: F450Gf2BoundaryMatrixGaussianRankSolverConfig = {
  featureId: F450_FEATURE_ID,
  stage: F450_STAGE,
  operationCode: F450_OPERATION_CODE,
  contractVersion: F450_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F450Gf2BoundaryMatrixGaussianRankSolverValidationError extends Error {
  public readonly featureId = F450_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F450 Validation Error on '${field}']: ${message}`);
    this.name = "F450Gf2BoundaryMatrixGaussianRankSolverValidationError";
    this.field = field;
  }
}

export function computeF450Digest(rawPayload: string): string {
  return `f450_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F450Gf2BoundaryMatrixGaussianRankSolverService extends KosmoraFeatureAdapterBase<
  typeof F450_FEATURE_ID,
  typeof F450_STAGE,
  typeof F450_OPERATION_CODE,
  F450Gf2BoundaryMatrixGaussianRankSolverConfig,
  F450Gf2BoundaryMatrixGaussianRankSolverInput,
  F450Gf2BoundaryMatrixGaussianRankSolverOutput
> {
  constructor(customConfig?: Partial<F450Gf2BoundaryMatrixGaussianRankSolverConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F450_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["boundary_matrix_b1", "boundary_matrix_b2", "field_modulus_p", "pivot_strategy"] as const,
      F450Gf2BoundaryMatrixGaussianRankSolverValidationError
    );
  }
}

export function verifyF450Module(): {
  readonly featureId: typeof F450_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F450Gf2BoundaryMatrixGaussianRankSolverService();
  const sampleInput: F450Gf2BoundaryMatrixGaussianRankSolverInput = {
    requestId: "req_verify_f450",
    projectId: "proj_kosmora_f450",
    workspaceId: "ws_kosmora_f450",
    tenantId: "tenant_rlm_f450",
    actorId: "actor_verifier_f450",
    autonomyLevel: "A3",
    boundary_matrix_b1: "seed_f450_boundary_matrix_b1",
    boundary_matrix_b2: 42,
    field_modulus_p: true,
    pivot_strategy: "seed_f450_pivot_strategy",
    metadata: { stage: "stage15-topological-persistence", featureId: "F450" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F450" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_boundary_matrix_b1 !== sampleInput.boundary_matrix_b1 &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F450] Verification failed`);
  }

  return {
    featureId: F450_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
