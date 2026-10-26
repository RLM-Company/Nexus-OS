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

export const F467_FEATURE_ID = "F467" as const;
export const F467_STAGE = "stage15-topological-persistence" as const;
export const F467_OPERATION_CODE = "F467_FORMAN_RICCI_COMBINATORIAL_CELL_CURVATURE" as const;
export const F467_CONTRACT_VERSION = "2.0.0" as const;

export type F467FormanRicciCombinatorialCellCurvatureConfig = BaseFeatureConfig<
  typeof F467_FEATURE_ID,
  typeof F467_STAGE,
  typeof F467_OPERATION_CODE
>;

export interface F467FormanRicciCombinatorialCellCurvatureInput extends BaseFeatureInput {
  readonly edge_weights: string | number | boolean | readonly string[];
  readonly vertex_weights: string | number | boolean | readonly string[];
  readonly incident_triangles: string | number | boolean | readonly string[];
  readonly forman_curvature_vec: string | number | boolean | readonly string[];
}

export interface F467FormanRicciCombinatorialCellCurvatureOutput {
  readonly featureId: typeof F467_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F467_OPERATION_CODE;
  readonly resolved_edge_weights: unknown;
  readonly resolved_vertex_weights: unknown;
  readonly resolved_incident_triangles: unknown;
  readonly resolved_forman_curvature_vec: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F467_FEATURE_ID>;
}

export type F467FormanRicciCombinatorialCellCurvatureTelemetrySnapshot = BaseFeatureTelemetry<typeof F467_FEATURE_ID>;

export const DEFAULT_F467_CONFIG: F467FormanRicciCombinatorialCellCurvatureConfig = {
  featureId: F467_FEATURE_ID,
  stage: F467_STAGE,
  operationCode: F467_OPERATION_CODE,
  contractVersion: F467_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F467FormanRicciCombinatorialCellCurvatureValidationError extends Error {
  public readonly featureId = F467_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F467 Validation Error on '${field}']: ${message}`);
    this.name = "F467FormanRicciCombinatorialCellCurvatureValidationError";
    this.field = field;
  }
}

export function computeF467Digest(rawPayload: string): string {
  return `f467_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F467FormanRicciCombinatorialCellCurvatureService extends KosmoraFeatureAdapterBase<
  typeof F467_FEATURE_ID,
  typeof F467_STAGE,
  typeof F467_OPERATION_CODE,
  F467FormanRicciCombinatorialCellCurvatureConfig,
  F467FormanRicciCombinatorialCellCurvatureInput,
  F467FormanRicciCombinatorialCellCurvatureOutput
> {
  constructor(customConfig?: Partial<F467FormanRicciCombinatorialCellCurvatureConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F467_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["edge_weights", "vertex_weights", "incident_triangles", "forman_curvature_vec"] as const,
      F467FormanRicciCombinatorialCellCurvatureValidationError
    );
  }
}

export function verifyF467Module(): {
  readonly featureId: typeof F467_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F467FormanRicciCombinatorialCellCurvatureService();
  const sampleInput: F467FormanRicciCombinatorialCellCurvatureInput = {
    requestId: "req_verify_f467",
    projectId: "proj_kosmora_f467",
    workspaceId: "ws_kosmora_f467",
    tenantId: "tenant_rlm_f467",
    actorId: "actor_verifier_f467",
    autonomyLevel: "A3",
    edge_weights: "seed_f467_edge_weights",
    vertex_weights: 42,
    incident_triangles: true,
    forman_curvature_vec: "seed_f467_forman_curvature_vec",
    metadata: { stage: "stage15-topological-persistence", featureId: "F467" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F467" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_edge_weights !== sampleInput.edge_weights &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F467] Verification failed`);
  }

  return {
    featureId: F467_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
