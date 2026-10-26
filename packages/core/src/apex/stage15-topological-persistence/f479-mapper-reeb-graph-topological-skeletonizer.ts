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

export const F479_FEATURE_ID = "F479" as const;
export const F479_STAGE = "stage15-topological-persistence" as const;
export const F479_OPERATION_CODE = "F479_MAPPER_REEB_GRAPH_TOPOLOGICAL_SKELETONIZER" as const;
export const F479_CONTRACT_VERSION = "2.0.0" as const;

export type F479MapperReebGraphTopologicalSkeletonizerConfig = BaseFeatureConfig<
  typeof F479_FEATURE_ID,
  typeof F479_STAGE,
  typeof F479_OPERATION_CODE
>;

export interface F479MapperReebGraphTopologicalSkeletonizerInput extends BaseFeatureInput {
  readonly filter_lens_values: string | number | boolean | readonly string[];
  readonly overlapping_intervals: string | number | boolean | readonly string[];
  readonly pullback_clusters: string | number | boolean | readonly string[];
  readonly nerve_skeleton_edges: string | number | boolean | readonly string[];
}

export interface F479MapperReebGraphTopologicalSkeletonizerOutput {
  readonly featureId: typeof F479_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F479_OPERATION_CODE;
  readonly resolved_filter_lens_values: unknown;
  readonly resolved_overlapping_intervals: unknown;
  readonly resolved_pullback_clusters: unknown;
  readonly resolved_nerve_skeleton_edges: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F479_FEATURE_ID>;
}

export type F479MapperReebGraphTopologicalSkeletonizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F479_FEATURE_ID
>;

export const DEFAULT_F479_CONFIG: F479MapperReebGraphTopologicalSkeletonizerConfig = {
  featureId: F479_FEATURE_ID,
  stage: F479_STAGE,
  operationCode: F479_OPERATION_CODE,
  contractVersion: F479_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F479MapperReebGraphTopologicalSkeletonizerValidationError extends Error {
  public readonly featureId = F479_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F479 Validation Error on '${field}']: ${message}`);
    this.name = "F479MapperReebGraphTopologicalSkeletonizerValidationError";
    this.field = field;
  }
}

export function computeF479Digest(rawPayload: string): string {
  return `f479_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F479MapperReebGraphTopologicalSkeletonizerService extends KosmoraFeatureAdapterBase<
  typeof F479_FEATURE_ID,
  typeof F479_STAGE,
  typeof F479_OPERATION_CODE,
  F479MapperReebGraphTopologicalSkeletonizerConfig,
  F479MapperReebGraphTopologicalSkeletonizerInput,
  F479MapperReebGraphTopologicalSkeletonizerOutput
> {
  constructor(
    customConfig?: Partial<F479MapperReebGraphTopologicalSkeletonizerConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F479_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "filter_lens_values",
        "overlapping_intervals",
        "pullback_clusters",
        "nerve_skeleton_edges"
      ] as const,
      F479MapperReebGraphTopologicalSkeletonizerValidationError
    );
  }
}

export function verifyF479Module(): {
  readonly featureId: typeof F479_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F479MapperReebGraphTopologicalSkeletonizerService();
  const sampleInput: F479MapperReebGraphTopologicalSkeletonizerInput = {
    requestId: "req_verify_f479",
    projectId: "proj_kosmora_f479",
    workspaceId: "ws_kosmora_f479",
    tenantId: "tenant_rlm_f479",
    actorId: "actor_verifier_f479",
    autonomyLevel: "A3",
    filter_lens_values: "seed_f479_filter_lens_values",
    overlapping_intervals: 42,
    pullback_clusters: true,
    nerve_skeleton_edges: "seed_f479_nerve_skeleton_edges",
    metadata: { stage: "stage15-topological-persistence", featureId: "F479" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F479" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_filter_lens_values !== sampleInput.filter_lens_values &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F479] Verification failed`);
  }

  return {
    featureId: F479_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
