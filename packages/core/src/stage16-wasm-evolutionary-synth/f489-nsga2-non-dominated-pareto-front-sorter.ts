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

export const F489_FEATURE_ID = "F489" as const;
export const F489_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F489_OPERATION_CODE = "F489_NSGA2_NON_DOMINATED_PARETO_FRONT_SORTER" as const;
export const F489_CONTRACT_VERSION = "2.0.0" as const;

export type F489Nsga2NonDominatedParetoFrontSorterConfig = BaseFeatureConfig<
  typeof F489_FEATURE_ID,
  typeof F489_STAGE,
  typeof F489_OPERATION_CODE
>;

export interface F489Nsga2NonDominatedParetoFrontSorterInput extends BaseFeatureInput {
  readonly candidate_population: string | number | boolean | readonly string[];
  readonly objective_vectors: string | number | boolean | readonly string[];
  readonly pareto_fronts_f1_fk: string | number | boolean | readonly string[];
  readonly domination_counts: string | number | boolean | readonly string[];
}

export interface F489Nsga2NonDominatedParetoFrontSorterOutput {
  readonly featureId: typeof F489_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F489_OPERATION_CODE;
  readonly resolved_candidate_population: unknown;
  readonly resolved_objective_vectors: unknown;
  readonly resolved_pareto_fronts_f1_fk: unknown;
  readonly resolved_domination_counts: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F489_FEATURE_ID>;
}

export type F489Nsga2NonDominatedParetoFrontSorterTelemetrySnapshot = BaseFeatureTelemetry<typeof F489_FEATURE_ID>;

export const DEFAULT_F489_CONFIG: F489Nsga2NonDominatedParetoFrontSorterConfig = {
  featureId: F489_FEATURE_ID,
  stage: F489_STAGE,
  operationCode: F489_OPERATION_CODE,
  contractVersion: F489_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F489Nsga2NonDominatedParetoFrontSorterValidationError extends Error {
  public readonly featureId = F489_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F489 Validation Error on '${field}']: ${message}`);
    this.name = "F489Nsga2NonDominatedParetoFrontSorterValidationError";
    this.field = field;
  }
}

export function computeF489Digest(rawPayload: string): string {
  return `f489_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F489Nsga2NonDominatedParetoFrontSorterService extends KosmoraFeatureAdapterBase<
  typeof F489_FEATURE_ID,
  typeof F489_STAGE,
  typeof F489_OPERATION_CODE,
  F489Nsga2NonDominatedParetoFrontSorterConfig,
  F489Nsga2NonDominatedParetoFrontSorterInput,
  F489Nsga2NonDominatedParetoFrontSorterOutput
> {
  constructor(customConfig?: Partial<F489Nsga2NonDominatedParetoFrontSorterConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F489_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["candidate_population", "objective_vectors", "pareto_fronts_f1_fk", "domination_counts"] as const,
      F489Nsga2NonDominatedParetoFrontSorterValidationError
    );
  }
}

export function verifyF489Module(): {
  readonly featureId: typeof F489_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F489Nsga2NonDominatedParetoFrontSorterService();
  const sampleInput: F489Nsga2NonDominatedParetoFrontSorterInput = {
    requestId: "req_verify_f489",
    projectId: "proj_kosmora_f489",
    workspaceId: "ws_kosmora_f489",
    tenantId: "tenant_rlm_f489",
    actorId: "actor_verifier_f489",
    autonomyLevel: "A3",
    candidate_population: "seed_f489_candidate_population",
    objective_vectors: 42,
    pareto_fronts_f1_fk: true,
    domination_counts: "seed_f489_domination_counts",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F489" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F489" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_population !== sampleInput.candidate_population &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F489] Verification failed`);
  }

  return {
    featureId: F489_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
