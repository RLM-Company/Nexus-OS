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

export const F490_FEATURE_ID = "F490" as const;
export const F490_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F490_OPERATION_CODE = "F490_PARETO_CROWDING_DISTANCE_DIVERSITY_ESTIMATOR" as const;
export const F490_CONTRACT_VERSION = "2.0.0" as const;

export type F490ParetoCrowdingDistanceDiversityEstimatorConfig = BaseFeatureConfig<
  typeof F490_FEATURE_ID,
  typeof F490_STAGE,
  typeof F490_OPERATION_CODE
>;

export interface F490ParetoCrowdingDistanceDiversityEstimatorInput extends BaseFeatureInput {
  readonly front_members: string | number | boolean | readonly string[];
  readonly normalized_objectives: string | number | boolean | readonly string[];
  readonly boundary_infinite_lock: string | number | boolean | readonly string[];
  readonly crowding_distances: string | number | boolean | readonly string[];
}

export interface F490ParetoCrowdingDistanceDiversityEstimatorOutput {
  readonly featureId: typeof F490_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F490_OPERATION_CODE;
  readonly resolved_front_members: unknown;
  readonly resolved_normalized_objectives: unknown;
  readonly resolved_boundary_infinite_lock: unknown;
  readonly resolved_crowding_distances: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F490_FEATURE_ID>;
}

export type F490ParetoCrowdingDistanceDiversityEstimatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F490_FEATURE_ID>;

export const DEFAULT_F490_CONFIG: F490ParetoCrowdingDistanceDiversityEstimatorConfig = {
  featureId: F490_FEATURE_ID,
  stage: F490_STAGE,
  operationCode: F490_OPERATION_CODE,
  contractVersion: F490_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F490ParetoCrowdingDistanceDiversityEstimatorValidationError extends Error {
  public readonly featureId = F490_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F490 Validation Error on '${field}']: ${message}`);
    this.name = "F490ParetoCrowdingDistanceDiversityEstimatorValidationError";
    this.field = field;
  }
}

export function computeF490Digest(rawPayload: string): string {
  return `f490_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F490ParetoCrowdingDistanceDiversityEstimatorService extends KosmoraFeatureAdapterBase<
  typeof F490_FEATURE_ID,
  typeof F490_STAGE,
  typeof F490_OPERATION_CODE,
  F490ParetoCrowdingDistanceDiversityEstimatorConfig,
  F490ParetoCrowdingDistanceDiversityEstimatorInput,
  F490ParetoCrowdingDistanceDiversityEstimatorOutput
> {
  constructor(customConfig?: Partial<F490ParetoCrowdingDistanceDiversityEstimatorConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F490_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["front_members", "normalized_objectives", "boundary_infinite_lock", "crowding_distances"] as const,
      F490ParetoCrowdingDistanceDiversityEstimatorValidationError
    );
  }
}

export function verifyF490Module(): {
  readonly featureId: typeof F490_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F490ParetoCrowdingDistanceDiversityEstimatorService();
  const sampleInput: F490ParetoCrowdingDistanceDiversityEstimatorInput = {
    requestId: "req_verify_f490",
    projectId: "proj_kosmora_f490",
    workspaceId: "ws_kosmora_f490",
    tenantId: "tenant_rlm_f490",
    actorId: "actor_verifier_f490",
    autonomyLevel: "A3",
    front_members: "seed_f490_front_members",
    normalized_objectives: 42,
    boundary_infinite_lock: true,
    crowding_distances: "seed_f490_crowding_distances",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F490" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F490" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_front_members !== sampleInput.front_members &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F490] Verification failed`);
  }

  return {
    featureId: F490_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
