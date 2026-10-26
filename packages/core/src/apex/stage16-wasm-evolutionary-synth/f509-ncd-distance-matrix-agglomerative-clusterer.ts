import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage16WasmEvolutionarySynthKernel } from "./stage-kernel.js";

export const F509_FEATURE_ID = "F509" as const;
export const F509_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F509_OPERATION_CODE = "F509_NCD_DISTANCE_MATRIX_AGGLOMERATIVE_CLUSTERER" as const;
export const F509_CONTRACT_VERSION = "2.0.0" as const;

export type F509NcdDistanceMatrixAgglomerativeClustererConfig = BaseFeatureConfig<
  typeof F509_FEATURE_ID,
  typeof F509_STAGE,
  typeof F509_OPERATION_CODE
>;

export interface F509NcdDistanceMatrixAgglomerativeClustererInput extends BaseFeatureInput {
  readonly artifact_Documents: string | number | boolean | readonly string[];
  readonly pairwise_ncd_matrix: string | number | boolean | readonly string[];
  readonly quartet_tree_topology: string | number | boolean | readonly string[];
  readonly cluster_assignments: string | number | boolean | readonly string[];
}

export interface F509NcdDistanceMatrixAgglomerativeClustererOutput {
  readonly featureId: typeof F509_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F509_OPERATION_CODE;
  readonly resolved_artifact_Documents: unknown;
  readonly resolved_pairwise_ncd_matrix: unknown;
  readonly resolved_quartet_tree_topology: unknown;
  readonly resolved_cluster_assignments: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F509_FEATURE_ID>;
}

export type F509NcdDistanceMatrixAgglomerativeClustererTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F509_FEATURE_ID
>;

export const DEFAULT_F509_CONFIG: F509NcdDistanceMatrixAgglomerativeClustererConfig = {
  featureId: F509_FEATURE_ID,
  stage: F509_STAGE,
  operationCode: F509_OPERATION_CODE,
  contractVersion: F509_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F509NcdDistanceMatrixAgglomerativeClustererValidationError extends Error {
  public readonly featureId = F509_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F509 Validation Error on '${field}']: ${message}`);
    this.name = "F509NcdDistanceMatrixAgglomerativeClustererValidationError";
    this.field = field;
  }
}

export function computeF509Digest(rawPayload: string): string {
  return `f509_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F509NcdDistanceMatrixAgglomerativeClustererService extends KosmoraFeatureAdapterBase<
  typeof F509_FEATURE_ID,
  typeof F509_STAGE,
  typeof F509_OPERATION_CODE,
  F509NcdDistanceMatrixAgglomerativeClustererConfig,
  F509NcdDistanceMatrixAgglomerativeClustererInput,
  F509NcdDistanceMatrixAgglomerativeClustererOutput
> {
  constructor(
    customConfig?: Partial<F509NcdDistanceMatrixAgglomerativeClustererConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F509_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "artifact_Documents",
        "pairwise_ncd_matrix",
        "quartet_tree_topology",
        "cluster_assignments"
      ] as const,
      F509NcdDistanceMatrixAgglomerativeClustererValidationError
    );
  }
}

export function verifyF509Module(): {
  readonly featureId: typeof F509_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F509NcdDistanceMatrixAgglomerativeClustererService();
  const sampleInput: F509NcdDistanceMatrixAgglomerativeClustererInput = {
    requestId: "req_verify_f509",
    projectId: "proj_kosmora_f509",
    workspaceId: "ws_kosmora_f509",
    tenantId: "tenant_rlm_f509",
    actorId: "actor_verifier_f509",
    autonomyLevel: "A3",
    artifact_Documents: "seed_f509_artifact_Documents",
    pairwise_ncd_matrix: 42,
    quartet_tree_topology: true,
    cluster_assignments: "seed_f509_cluster_assignments",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F509" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F509" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_Documents !== sampleInput.artifact_Documents &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F509] Verification failed`);
  }

  return {
    featureId: F509_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
