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

export const F491_FEATURE_ID = "F491" as const;
export const F491_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F491_OPERATION_CODE = "F491_HYPERVOLUME_INDICATOR_PARETO_CONVERGENCE_CALC" as const;
export const F491_CONTRACT_VERSION = "2.0.0" as const;

export type F491HypervolumeIndicatorParetoConvergenceCalcConfig = BaseFeatureConfig<
  typeof F491_FEATURE_ID,
  typeof F491_STAGE,
  typeof F491_OPERATION_CODE
>;

export interface F491HypervolumeIndicatorParetoConvergenceCalcInput extends BaseFeatureInput {
  readonly pareto_front_points: string | number | boolean | readonly string[];
  readonly reference_nadir_point: string | number | boolean | readonly string[];
  readonly dominated_hypervolume: string | number | boolean | readonly string[];
  readonly convergence_delta: string | number | boolean | readonly string[];
}

export interface F491HypervolumeIndicatorParetoConvergenceCalcOutput {
  readonly featureId: typeof F491_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F491_OPERATION_CODE;
  readonly resolved_pareto_front_points: unknown;
  readonly resolved_reference_nadir_point: unknown;
  readonly resolved_dominated_hypervolume: unknown;
  readonly resolved_convergence_delta: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F491_FEATURE_ID>;
}

export type F491HypervolumeIndicatorParetoConvergenceCalcTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F491_FEATURE_ID
>;

export const DEFAULT_F491_CONFIG: F491HypervolumeIndicatorParetoConvergenceCalcConfig = {
  featureId: F491_FEATURE_ID,
  stage: F491_STAGE,
  operationCode: F491_OPERATION_CODE,
  contractVersion: F491_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F491HypervolumeIndicatorParetoConvergenceCalcValidationError extends Error {
  public readonly featureId = F491_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F491 Validation Error on '${field}']: ${message}`);
    this.name = "F491HypervolumeIndicatorParetoConvergenceCalcValidationError";
    this.field = field;
  }
}

export function computeF491Digest(rawPayload: string): string {
  return `f491_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F491HypervolumeIndicatorParetoConvergenceCalcService extends KosmoraFeatureAdapterBase<
  typeof F491_FEATURE_ID,
  typeof F491_STAGE,
  typeof F491_OPERATION_CODE,
  F491HypervolumeIndicatorParetoConvergenceCalcConfig,
  F491HypervolumeIndicatorParetoConvergenceCalcInput,
  F491HypervolumeIndicatorParetoConvergenceCalcOutput
> {
  constructor(
    customConfig?: Partial<F491HypervolumeIndicatorParetoConvergenceCalcConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F491_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "pareto_front_points",
        "reference_nadir_point",
        "dominated_hypervolume",
        "convergence_delta"
      ] as const,
      F491HypervolumeIndicatorParetoConvergenceCalcValidationError
    );
  }
}

export function verifyF491Module(): {
  readonly featureId: typeof F491_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F491HypervolumeIndicatorParetoConvergenceCalcService();
  const sampleInput: F491HypervolumeIndicatorParetoConvergenceCalcInput = {
    requestId: "req_verify_f491",
    projectId: "proj_kosmora_f491",
    workspaceId: "ws_kosmora_f491",
    tenantId: "tenant_rlm_f491",
    actorId: "actor_verifier_f491",
    autonomyLevel: "A3",
    pareto_front_points: "seed_f491_pareto_front_points",
    reference_nadir_point: 42,
    dominated_hypervolume: true,
    convergence_delta: "seed_f491_convergence_delta",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F491" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F491" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_pareto_front_points !== sampleInput.pareto_front_points &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F491] Verification failed`);
  }

  return {
    featureId: F491_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
