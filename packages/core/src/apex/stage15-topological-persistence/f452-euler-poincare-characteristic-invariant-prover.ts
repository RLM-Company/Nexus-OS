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

export const F452_FEATURE_ID = "F452" as const;
export const F452_STAGE = "stage15-topological-persistence" as const;
export const F452_OPERATION_CODE = "F452_EULER_POINCARE_CHARACTERISTIC_INVARIANT_PROVER" as const;
export const F452_CONTRACT_VERSION = "2.0.0" as const;

export type F452EulerPoincareCharacteristicInvariantProverConfig = BaseFeatureConfig<
  typeof F452_FEATURE_ID,
  typeof F452_STAGE,
  typeof F452_OPERATION_CODE
>;

export interface F452EulerPoincareCharacteristicInvariantProverInput extends BaseFeatureInput {
  readonly vertices_count_v: string | number | boolean | readonly string[];
  readonly edges_count_e: string | number | boolean | readonly string[];
  readonly faces_count_f: string | number | boolean | readonly string[];
  readonly alternating_betti_sum: string | number | boolean | readonly string[];
}

export interface F452EulerPoincareCharacteristicInvariantProverOutput {
  readonly featureId: typeof F452_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F452_OPERATION_CODE;
  readonly resolved_vertices_count_v: unknown;
  readonly resolved_edges_count_e: unknown;
  readonly resolved_faces_count_f: unknown;
  readonly resolved_alternating_betti_sum: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F452_FEATURE_ID>;
}

export type F452EulerPoincareCharacteristicInvariantProverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F452_FEATURE_ID
>;

export const DEFAULT_F452_CONFIG: F452EulerPoincareCharacteristicInvariantProverConfig = {
  featureId: F452_FEATURE_ID,
  stage: F452_STAGE,
  operationCode: F452_OPERATION_CODE,
  contractVersion: F452_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F452EulerPoincareCharacteristicInvariantProverValidationError extends Error {
  public readonly featureId = F452_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F452 Validation Error on '${field}']: ${message}`);
    this.name = "F452EulerPoincareCharacteristicInvariantProverValidationError";
    this.field = field;
  }
}

export function computeF452Digest(rawPayload: string): string {
  return `f452_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F452EulerPoincareCharacteristicInvariantProverService extends KosmoraFeatureAdapterBase<
  typeof F452_FEATURE_ID,
  typeof F452_STAGE,
  typeof F452_OPERATION_CODE,
  F452EulerPoincareCharacteristicInvariantProverConfig,
  F452EulerPoincareCharacteristicInvariantProverInput,
  F452EulerPoincareCharacteristicInvariantProverOutput
> {
  constructor(
    customConfig?: Partial<F452EulerPoincareCharacteristicInvariantProverConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F452_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["vertices_count_v", "edges_count_e", "faces_count_f", "alternating_betti_sum"] as const,
      F452EulerPoincareCharacteristicInvariantProverValidationError
    );
  }
}

export function verifyF452Module(): {
  readonly featureId: typeof F452_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F452EulerPoincareCharacteristicInvariantProverService();
  const sampleInput: F452EulerPoincareCharacteristicInvariantProverInput = {
    requestId: "req_verify_f452",
    projectId: "proj_kosmora_f452",
    workspaceId: "ws_kosmora_f452",
    tenantId: "tenant_rlm_f452",
    actorId: "actor_verifier_f452",
    autonomyLevel: "A3",
    vertices_count_v: "seed_f452_vertices_count_v",
    edges_count_e: 42,
    faces_count_f: true,
    alternating_betti_sum: "seed_f452_alternating_betti_sum",
    metadata: { stage: "stage15-topological-persistence", featureId: "F452" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F452" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_vertices_count_v !== sampleInput.vertices_count_v &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F452] Verification failed`);
  }

  return {
    featureId: F452_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
