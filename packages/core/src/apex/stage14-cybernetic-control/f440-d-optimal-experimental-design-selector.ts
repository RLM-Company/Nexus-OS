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

export const F440_FEATURE_ID = "F440" as const;
export const F440_STAGE = "stage14-cybernetic-control" as const;
export const F440_OPERATION_CODE = "F440_D_OPTIMAL_EXPERIMENTAL_DESIGN_SELECTOR" as const;
export const F440_CONTRACT_VERSION = "2.0.0" as const;

export type F440DOptimalExperimentalDesignSelectorConfig = BaseFeatureConfig<
  typeof F440_FEATURE_ID,
  typeof F440_STAGE,
  typeof F440_OPERATION_CODE
>;

export interface F440DOptimalExperimentalDesignSelectorInput extends BaseFeatureInput {
  readonly candidate_feature_rows: string | number | boolean | readonly string[];
  readonly selection_budget_k: string | number | boolean | readonly string[];
  readonly regularization_lambda: string | number | boolean | readonly string[];
  readonly determinant_log_mode: string | number | boolean | readonly string[];
}

export interface F440DOptimalExperimentalDesignSelectorOutput {
  readonly featureId: typeof F440_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F440_OPERATION_CODE;
  readonly resolved_candidate_feature_rows: unknown;
  readonly resolved_selection_budget_k: unknown;
  readonly resolved_regularization_lambda: unknown;
  readonly resolved_determinant_log_mode: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F440_FEATURE_ID>;
}

export type F440DOptimalExperimentalDesignSelectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F440_FEATURE_ID
>;

export const DEFAULT_F440_CONFIG: F440DOptimalExperimentalDesignSelectorConfig = {
  featureId: F440_FEATURE_ID,
  stage: F440_STAGE,
  operationCode: F440_OPERATION_CODE,
  contractVersion: F440_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F440DOptimalExperimentalDesignSelectorValidationError extends Error {
  public readonly featureId = F440_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F440 Validation Error on '${field}']: ${message}`);
    this.name = "F440DOptimalExperimentalDesignSelectorValidationError";
    this.field = field;
  }
}

export function computeF440Digest(rawPayload: string): string {
  return `f440_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F440DOptimalExperimentalDesignSelectorService extends KosmoraFeatureAdapterBase<
  typeof F440_FEATURE_ID,
  typeof F440_STAGE,
  typeof F440_OPERATION_CODE,
  F440DOptimalExperimentalDesignSelectorConfig,
  F440DOptimalExperimentalDesignSelectorInput,
  F440DOptimalExperimentalDesignSelectorOutput
> {
  constructor(
    customConfig?: Partial<F440DOptimalExperimentalDesignSelectorConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F440_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      [
        "candidate_feature_rows",
        "selection_budget_k",
        "regularization_lambda",
        "determinant_log_mode"
      ] as const,
      F440DOptimalExperimentalDesignSelectorValidationError
    );
  }
}

export function verifyF440Module(): {
  readonly featureId: typeof F440_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F440DOptimalExperimentalDesignSelectorService();
  const sampleInput: F440DOptimalExperimentalDesignSelectorInput = {
    requestId: "req_verify_f440",
    projectId: "proj_kosmora_f440",
    workspaceId: "ws_kosmora_f440",
    tenantId: "tenant_rlm_f440",
    actorId: "actor_verifier_f440",
    autonomyLevel: "A3",
    candidate_feature_rows: "seed_f440_candidate_feature_rows",
    selection_budget_k: 42,
    regularization_lambda: true,
    determinant_log_mode: "seed_f440_determinant_log_mode",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F440" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F440" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_feature_rows !== sampleInput.candidate_feature_rows &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F440] Verification failed`);
  }

  return {
    featureId: F440_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
