/**
 * F323 (stage11-causal-bayesian): Детектор конфаундеров и критерия обходного пути (Backdoor Criterion Analyzer)
 * Идентификация общих предков воздействия и исхода для устранения смещения отбора
 * Operation Code: backdoor_confounder_finder
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F323_FEATURE_ID = "F323" as const;
export const F323_STAGE = "stage11-causal-bayesian" as const;
export const F323_OPERATION_CODE = "backdoor_confounder_finder" as const;
export const F323_CONTRACT_VERSION = "2.0.0" as const;

export type F323BackdoorConfounderAdjustmentFinderConfig = BaseFeatureConfig<
  typeof F323_FEATURE_ID,
  typeof F323_STAGE,
  typeof F323_OPERATION_CODE
>;

export interface F323BackdoorConfounderAdjustmentFinderInput extends BaseFeatureInput {
  readonly treatment_node: string | number | boolean | readonly string[];
  readonly outcome_node: string | number | boolean | readonly string[];
  readonly detected_confounders: string | number | boolean | readonly string[];
  readonly backdoor_blocked: string | number | boolean | readonly string[];
}

export interface F323BackdoorConfounderAdjustmentFinderOutput {
  readonly featureId: typeof F323_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F323_OPERATION_CODE;
  readonly resolved_treatment_node: unknown;
  readonly resolved_outcome_node: unknown;
  readonly resolved_detected_confounders: unknown;
  readonly resolved_backdoor_blocked: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F323_FEATURE_ID>;
}

export type F323BackdoorConfounderAdjustmentFinderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F323_FEATURE_ID
>;

export const DEFAULT_F323_CONFIG: F323BackdoorConfounderAdjustmentFinderConfig = {
  featureId: F323_FEATURE_ID,
  stage: F323_STAGE,
  operationCode: F323_OPERATION_CODE,
  contractVersion: F323_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F323BackdoorConfounderAdjustmentFinderValidationError extends Error {
  public readonly featureId = F323_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F323 Validation Error on '${field}']: ${message}`);
    this.name = "F323BackdoorConfounderAdjustmentFinderValidationError";
    this.field = field;
  }
}

export function computeF323Digest(rawPayload: string): string {
  return `f323_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F323BackdoorConfounderAdjustmentFinderService extends KosmoraFeatureAdapterBase<
  typeof F323_FEATURE_ID,
  typeof F323_STAGE,
  typeof F323_OPERATION_CODE,
  F323BackdoorConfounderAdjustmentFinderConfig,
  F323BackdoorConfounderAdjustmentFinderInput,
  F323BackdoorConfounderAdjustmentFinderOutput
> {
  constructor(
    customConfig?: Partial<F323BackdoorConfounderAdjustmentFinderConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F323_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["treatment_node", "outcome_node", "detected_confounders", "backdoor_blocked"] as const,
      F323BackdoorConfounderAdjustmentFinderValidationError
    );
  }
}

export function verifyF323Module(): {
  readonly featureId: typeof F323_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F323BackdoorConfounderAdjustmentFinderService();
  const sampleInput: F323BackdoorConfounderAdjustmentFinderInput = {
    requestId: "req_verify_f323",
    projectId: "proj_kosmora_f323",
    workspaceId: "ws_kosmora_f323",
    tenantId: "tenant_rlm_f323",
    actorId: "actor_verifier_f323",
    autonomyLevel: "A3",
    treatment_node: "seed_f323_treatment_node",
    outcome_node: 42,
    detected_confounders: true,
    backdoor_blocked: "seed_f323_backdoor_blocked",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F323" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F323" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_treatment_node !== sampleInput.treatment_node &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F323] Verification failed`);
  }

  return {
    featureId: F323_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
