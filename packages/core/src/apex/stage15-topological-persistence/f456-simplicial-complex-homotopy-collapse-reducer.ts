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

export const F456_FEATURE_ID = "F456" as const;
export const F456_STAGE = "stage15-topological-persistence" as const;
export const F456_OPERATION_CODE = "F456_SIMPLICIAL_COMPLEX_HOMOTOPY_COLLAPSE_REDUCER" as const;
export const F456_CONTRACT_VERSION = "2.0.0" as const;

export type F456SimplicialComplexHomotopyCollapseReducerConfig = BaseFeatureConfig<
  typeof F456_FEATURE_ID,
  typeof F456_STAGE,
  typeof F456_OPERATION_CODE
>;

export interface F456SimplicialComplexHomotopyCollapseReducerInput extends BaseFeatureInput {
  readonly free_faces_list: string | number | boolean | readonly string[];
  readonly elementary_collapses: string | number | boolean | readonly string[];
  readonly core_subcomplex: string | number | boolean | readonly string[];
  readonly betti_preserved: string | number | boolean | readonly string[];
}

export interface F456SimplicialComplexHomotopyCollapseReducerOutput {
  readonly featureId: typeof F456_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F456_OPERATION_CODE;
  readonly resolved_free_faces_list: unknown;
  readonly resolved_elementary_collapses: unknown;
  readonly resolved_core_subcomplex: unknown;
  readonly resolved_betti_preserved: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F456_FEATURE_ID>;
}

export type F456SimplicialComplexHomotopyCollapseReducerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F456_FEATURE_ID
>;

export const DEFAULT_F456_CONFIG: F456SimplicialComplexHomotopyCollapseReducerConfig = {
  featureId: F456_FEATURE_ID,
  stage: F456_STAGE,
  operationCode: F456_OPERATION_CODE,
  contractVersion: F456_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F456SimplicialComplexHomotopyCollapseReducerValidationError extends Error {
  public readonly featureId = F456_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F456 Validation Error on '${field}']: ${message}`);
    this.name = "F456SimplicialComplexHomotopyCollapseReducerValidationError";
    this.field = field;
  }
}

export function computeF456Digest(rawPayload: string): string {
  return `f456_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F456SimplicialComplexHomotopyCollapseReducerService extends KosmoraFeatureAdapterBase<
  typeof F456_FEATURE_ID,
  typeof F456_STAGE,
  typeof F456_OPERATION_CODE,
  F456SimplicialComplexHomotopyCollapseReducerConfig,
  F456SimplicialComplexHomotopyCollapseReducerInput,
  F456SimplicialComplexHomotopyCollapseReducerOutput
> {
  constructor(
    customConfig?: Partial<F456SimplicialComplexHomotopyCollapseReducerConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F456_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["free_faces_list", "elementary_collapses", "core_subcomplex", "betti_preserved"] as const,
      F456SimplicialComplexHomotopyCollapseReducerValidationError
    );
  }
}

export function verifyF456Module(): {
  readonly featureId: typeof F456_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F456SimplicialComplexHomotopyCollapseReducerService();
  const sampleInput: F456SimplicialComplexHomotopyCollapseReducerInput = {
    requestId: "req_verify_f456",
    projectId: "proj_kosmora_f456",
    workspaceId: "ws_kosmora_f456",
    tenantId: "tenant_rlm_f456",
    actorId: "actor_verifier_f456",
    autonomyLevel: "A3",
    free_faces_list: "seed_f456_free_faces_list",
    elementary_collapses: 42,
    core_subcomplex: true,
    betti_preserved: "seed_f456_betti_preserved",
    metadata: { stage: "stage15-topological-persistence", featureId: "F456" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F456" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_free_faces_list !== sampleInput.free_faces_list &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F456] Verification failed`);
  }

  return {
    featureId: F456_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
