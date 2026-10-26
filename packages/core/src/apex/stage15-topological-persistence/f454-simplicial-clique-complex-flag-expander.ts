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

export const F454_FEATURE_ID = "F454" as const;
export const F454_STAGE = "stage15-topological-persistence" as const;
export const F454_OPERATION_CODE = "F454_SIMPLICIAL_CLIQUE_COMPLEX_FLAG_EXPANDER" as const;
export const F454_CONTRACT_VERSION = "2.0.0" as const;

export type F454SimplicialCliqueComplexFlagExpanderConfig = BaseFeatureConfig<
  typeof F454_FEATURE_ID,
  typeof F454_STAGE,
  typeof F454_OPERATION_CODE
>;

export interface F454SimplicialCliqueComplexFlagExpanderInput extends BaseFeatureInput {
  readonly one_skeleton_edges: string | number | boolean | readonly string[];
  readonly max_clique_k: string | number | boolean | readonly string[];
  readonly triangles_materialized: string | number | boolean | readonly string[];
  readonly tetrahedra_count: string | number | boolean | readonly string[];
}

export interface F454SimplicialCliqueComplexFlagExpanderOutput {
  readonly featureId: typeof F454_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F454_OPERATION_CODE;
  readonly resolved_one_skeleton_edges: unknown;
  readonly resolved_max_clique_k: unknown;
  readonly resolved_triangles_materialized: unknown;
  readonly resolved_tetrahedra_count: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F454_FEATURE_ID>;
}

export type F454SimplicialCliqueComplexFlagExpanderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F454_FEATURE_ID
>;

export const DEFAULT_F454_CONFIG: F454SimplicialCliqueComplexFlagExpanderConfig = {
  featureId: F454_FEATURE_ID,
  stage: F454_STAGE,
  operationCode: F454_OPERATION_CODE,
  contractVersion: F454_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F454SimplicialCliqueComplexFlagExpanderValidationError extends Error {
  public readonly featureId = F454_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F454 Validation Error on '${field}']: ${message}`);
    this.name = "F454SimplicialCliqueComplexFlagExpanderValidationError";
    this.field = field;
  }
}

export function computeF454Digest(rawPayload: string): string {
  return `f454_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F454SimplicialCliqueComplexFlagExpanderService extends KosmoraFeatureAdapterBase<
  typeof F454_FEATURE_ID,
  typeof F454_STAGE,
  typeof F454_OPERATION_CODE,
  F454SimplicialCliqueComplexFlagExpanderConfig,
  F454SimplicialCliqueComplexFlagExpanderInput,
  F454SimplicialCliqueComplexFlagExpanderOutput
> {
  constructor(
    customConfig?: Partial<F454SimplicialCliqueComplexFlagExpanderConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F454_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["one_skeleton_edges", "max_clique_k", "triangles_materialized", "tetrahedra_count"] as const,
      F454SimplicialCliqueComplexFlagExpanderValidationError
    );
  }
}

export function verifyF454Module(): {
  readonly featureId: typeof F454_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F454SimplicialCliqueComplexFlagExpanderService();
  const sampleInput: F454SimplicialCliqueComplexFlagExpanderInput = {
    requestId: "req_verify_f454",
    projectId: "proj_kosmora_f454",
    workspaceId: "ws_kosmora_f454",
    tenantId: "tenant_rlm_f454",
    actorId: "actor_verifier_f454",
    autonomyLevel: "A3",
    one_skeleton_edges: "seed_f454_one_skeleton_edges",
    max_clique_k: 42,
    triangles_materialized: true,
    tetrahedra_count: "seed_f454_tetrahedra_count",
    metadata: { stage: "stage15-topological-persistence", featureId: "F454" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F454" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_one_skeleton_edges !== sampleInput.one_skeleton_edges &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F454] Verification failed`);
  }

  return {
    featureId: F454_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
