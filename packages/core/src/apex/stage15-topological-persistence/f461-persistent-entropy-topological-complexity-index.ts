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

export const F461_FEATURE_ID = "F461" as const;
export const F461_STAGE = "stage15-topological-persistence" as const;
export const F461_OPERATION_CODE = "F461_PERSISTENT_ENTROPY_TOPOLOGICAL_COMPLEXITY_INDEX" as const;
export const F461_CONTRACT_VERSION = "2.0.0" as const;

export type F461PersistentEntropyTopologicalComplexityIndexConfig = BaseFeatureConfig<
  typeof F461_FEATURE_ID,
  typeof F461_STAGE,
  typeof F461_OPERATION_CODE
>;

export interface F461PersistentEntropyTopologicalComplexityIndexInput extends BaseFeatureInput {
  readonly barcode_lifetimes: string | number | boolean | readonly string[];
  readonly total_persistence_sum: string | number | boolean | readonly string[];
  readonly shannon_entropy_bits: string | number | boolean | readonly string[];
  readonly noise_cutoff: string | number | boolean | readonly string[];
}

export interface F461PersistentEntropyTopologicalComplexityIndexOutput {
  readonly featureId: typeof F461_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F461_OPERATION_CODE;
  readonly resolved_barcode_lifetimes: unknown;
  readonly resolved_total_persistence_sum: unknown;
  readonly resolved_shannon_entropy_bits: unknown;
  readonly resolved_noise_cutoff: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F461_FEATURE_ID>;
}

export type F461PersistentEntropyTopologicalComplexityIndexTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F461_FEATURE_ID
>;

export const DEFAULT_F461_CONFIG: F461PersistentEntropyTopologicalComplexityIndexConfig = {
  featureId: F461_FEATURE_ID,
  stage: F461_STAGE,
  operationCode: F461_OPERATION_CODE,
  contractVersion: F461_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F461PersistentEntropyTopologicalComplexityIndexValidationError extends Error {
  public readonly featureId = F461_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F461 Validation Error on '${field}']: ${message}`);
    this.name = "F461PersistentEntropyTopologicalComplexityIndexValidationError";
    this.field = field;
  }
}

export function computeF461Digest(rawPayload: string): string {
  return `f461_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F461PersistentEntropyTopologicalComplexityIndexService extends KosmoraFeatureAdapterBase<
  typeof F461_FEATURE_ID,
  typeof F461_STAGE,
  typeof F461_OPERATION_CODE,
  F461PersistentEntropyTopologicalComplexityIndexConfig,
  F461PersistentEntropyTopologicalComplexityIndexInput,
  F461PersistentEntropyTopologicalComplexityIndexOutput
> {
  constructor(
    customConfig?: Partial<F461PersistentEntropyTopologicalComplexityIndexConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F461_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "barcode_lifetimes",
        "total_persistence_sum",
        "shannon_entropy_bits",
        "noise_cutoff"
      ] as const,
      F461PersistentEntropyTopologicalComplexityIndexValidationError
    );
  }
}

export function verifyF461Module(): {
  readonly featureId: typeof F461_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F461PersistentEntropyTopologicalComplexityIndexService();
  const sampleInput: F461PersistentEntropyTopologicalComplexityIndexInput = {
    requestId: "req_verify_f461",
    projectId: "proj_kosmora_f461",
    workspaceId: "ws_kosmora_f461",
    tenantId: "tenant_rlm_f461",
    actorId: "actor_verifier_f461",
    autonomyLevel: "A3",
    barcode_lifetimes: "seed_f461_barcode_lifetimes",
    total_persistence_sum: 42,
    shannon_entropy_bits: true,
    noise_cutoff: "seed_f461_noise_cutoff",
    metadata: { stage: "stage15-topological-persistence", featureId: "F461" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F461" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_barcode_lifetimes !== sampleInput.barcode_lifetimes &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F461] Verification failed`);
  }

  return {
    featureId: F461_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
