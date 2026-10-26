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

export const F455_FEATURE_ID = "F455" as const;
export const F455_STAGE = "stage15-topological-persistence" as const;
export const F455_OPERATION_CODE = "F455_COHOMOLOGY_COCYCLE_OBSTRUCTION_DETECTOR" as const;
export const F455_CONTRACT_VERSION = "2.0.0" as const;

export type F455CohomologyCocycleObstructionDetectorConfig = BaseFeatureConfig<
  typeof F455_FEATURE_ID,
  typeof F455_STAGE,
  typeof F455_OPERATION_CODE
>;

export interface F455CohomologyCocycleObstructionDetectorInput extends BaseFeatureInput {
  readonly coboundary_matrix: string | number | boolean | readonly string[];
  readonly local_sections: string | number | boolean | readonly string[];
  readonly global_consistency: string | number | boolean | readonly string[];
  readonly obstruction_class: string | number | boolean | readonly string[];
}

export interface F455CohomologyCocycleObstructionDetectorOutput {
  readonly featureId: typeof F455_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F455_OPERATION_CODE;
  readonly resolved_coboundary_matrix: unknown;
  readonly resolved_local_sections: unknown;
  readonly resolved_global_consistency: unknown;
  readonly resolved_obstruction_class: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F455_FEATURE_ID>;
}

export type F455CohomologyCocycleObstructionDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F455_FEATURE_ID>;

export const DEFAULT_F455_CONFIG: F455CohomologyCocycleObstructionDetectorConfig = {
  featureId: F455_FEATURE_ID,
  stage: F455_STAGE,
  operationCode: F455_OPERATION_CODE,
  contractVersion: F455_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F455CohomologyCocycleObstructionDetectorValidationError extends Error {
  public readonly featureId = F455_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F455 Validation Error on '${field}']: ${message}`);
    this.name = "F455CohomologyCocycleObstructionDetectorValidationError";
    this.field = field;
  }
}

export function computeF455Digest(rawPayload: string): string {
  return `f455_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F455CohomologyCocycleObstructionDetectorService extends KosmoraFeatureAdapterBase<
  typeof F455_FEATURE_ID,
  typeof F455_STAGE,
  typeof F455_OPERATION_CODE,
  F455CohomologyCocycleObstructionDetectorConfig,
  F455CohomologyCocycleObstructionDetectorInput,
  F455CohomologyCocycleObstructionDetectorOutput
> {
  constructor(customConfig?: Partial<F455CohomologyCocycleObstructionDetectorConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F455_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["coboundary_matrix", "local_sections", "global_consistency", "obstruction_class"] as const,
      F455CohomologyCocycleObstructionDetectorValidationError
    );
  }
}

export function verifyF455Module(): {
  readonly featureId: typeof F455_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F455CohomologyCocycleObstructionDetectorService();
  const sampleInput: F455CohomologyCocycleObstructionDetectorInput = {
    requestId: "req_verify_f455",
    projectId: "proj_kosmora_f455",
    workspaceId: "ws_kosmora_f455",
    tenantId: "tenant_rlm_f455",
    actorId: "actor_verifier_f455",
    autonomyLevel: "A3",
    coboundary_matrix: "seed_f455_coboundary_matrix",
    local_sections: 42,
    global_consistency: true,
    obstruction_class: "seed_f455_obstruction_class",
    metadata: { stage: "stage15-topological-persistence", featureId: "F455" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F455" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_coboundary_matrix !== sampleInput.coboundary_matrix &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F455] Verification failed`);
  }

  return {
    featureId: F455_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
