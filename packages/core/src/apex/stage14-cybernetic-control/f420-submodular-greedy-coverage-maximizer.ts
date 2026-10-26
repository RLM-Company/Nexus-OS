import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage14CyberneticControlKernel } from "./stage-kernel.js";

export const F420_FEATURE_ID = "F420" as const;
export const F420_STAGE = "stage14-cybernetic-control" as const;
export const F420_OPERATION_CODE = "F420_SUBMODULAR_GREEDY_COVERAGE_MAXIMIZER" as const;
export const F420_CONTRACT_VERSION = "2.0.0" as const;

export type F420SubmodularGreedyCoverageMaximizerConfig = BaseFeatureConfig<
  typeof F420_FEATURE_ID,
  typeof F420_STAGE,
  typeof F420_OPERATION_CODE
>;

export interface F420SubmodularGreedyCoverageMaximizerInput extends BaseFeatureInput {
  readonly candidate_elements: string | number | boolean | readonly string[];
  readonly cardinality_budget_k: string | number | boolean | readonly string[];
  readonly element_weights: string | number | boolean | readonly string[];
  readonly marginal_gain_floor: string | number | boolean | readonly string[];
}

export interface F420SubmodularGreedyCoverageMaximizerOutput {
  readonly featureId: typeof F420_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F420_OPERATION_CODE;
  readonly resolved_candidate_elements: unknown;
  readonly resolved_cardinality_budget_k: unknown;
  readonly resolved_element_weights: unknown;
  readonly resolved_marginal_gain_floor: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F420_FEATURE_ID>;
}

export type F420SubmodularGreedyCoverageMaximizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F420_FEATURE_ID
>;

export const DEFAULT_F420_CONFIG: F420SubmodularGreedyCoverageMaximizerConfig = {
  featureId: F420_FEATURE_ID,
  stage: F420_STAGE,
  operationCode: F420_OPERATION_CODE,
  contractVersion: F420_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F420SubmodularGreedyCoverageMaximizerValidationError extends Error {
  public readonly featureId = F420_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F420 Validation Error on '${field}']: ${message}`);
    this.name = "F420SubmodularGreedyCoverageMaximizerValidationError";
    this.field = field;
  }
}

export function computeF420Digest(rawPayload: string): string {
  return `f420_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F420SubmodularGreedyCoverageMaximizerService extends KosmoraFeatureAdapterBase<
  typeof F420_FEATURE_ID,
  typeof F420_STAGE,
  typeof F420_OPERATION_CODE,
  F420SubmodularGreedyCoverageMaximizerConfig,
  F420SubmodularGreedyCoverageMaximizerInput,
  F420SubmodularGreedyCoverageMaximizerOutput
> {
  constructor(
    customConfig?: Partial<F420SubmodularGreedyCoverageMaximizerConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F420_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      [
        "candidate_elements",
        "cardinality_budget_k",
        "element_weights",
        "marginal_gain_floor"
      ] as const,
      F420SubmodularGreedyCoverageMaximizerValidationError
    );
  }
}

export function verifyF420Module(): {
  readonly featureId: typeof F420_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F420SubmodularGreedyCoverageMaximizerService();
  const sampleInput: F420SubmodularGreedyCoverageMaximizerInput = {
    requestId: "req_verify_f420",
    projectId: "proj_kosmora_f420",
    workspaceId: "ws_kosmora_f420",
    tenantId: "tenant_rlm_f420",
    actorId: "actor_verifier_f420",
    autonomyLevel: "A3",
    candidate_elements: "seed_f420_candidate_elements",
    cardinality_budget_k: 42,
    element_weights: true,
    marginal_gain_floor: "seed_f420_marginal_gain_floor",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F420" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F420" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_elements !== sampleInput.candidate_elements &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F420] Verification failed`);
  }

  return {
    featureId: F420_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
