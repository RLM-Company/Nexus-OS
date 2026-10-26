/**
 * F339 (stage11-causal-bayesian): Классификатор наиболее вероятной гипотезы отказа (Maximum A Posteriori Fault Finder)
 * Выбор корневой причины инцидента с максимальной апостериорной вероятностью argmax_H P(H | E)
 * Operation Code: bayes_map_diagnostician
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

export const F339_FEATURE_ID = "F339" as const;
export const F339_STAGE = "stage11-causal-bayesian" as const;
export const F339_OPERATION_CODE = "bayes_map_diagnostician" as const;
export const F339_CONTRACT_VERSION = "2.0.0" as const;

export type F339MapMaximumAPosterioriFaultDiagnosticianConfig = BaseFeatureConfig<
  typeof F339_FEATURE_ID,
  typeof F339_STAGE,
  typeof F339_OPERATION_CODE
>;

export interface F339MapMaximumAPosterioriFaultDiagnosticianInput extends BaseFeatureInput {
  readonly map_hypothesis: string | number | boolean | readonly string[];
  readonly map_probability: string | number | boolean | readonly string[];
  readonly runner_up_gap: string | number | boolean | readonly string[];
  readonly confidence_tier: string | number | boolean | readonly string[];
}

export interface F339MapMaximumAPosterioriFaultDiagnosticianOutput {
  readonly featureId: typeof F339_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F339_OPERATION_CODE;
  readonly resolved_map_hypothesis: unknown;
  readonly resolved_map_probability: unknown;
  readonly resolved_runner_up_gap: unknown;
  readonly resolved_confidence_tier: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F339_FEATURE_ID>;
}

export type F339MapMaximumAPosterioriFaultDiagnosticianTelemetrySnapshot = BaseFeatureTelemetry<typeof F339_FEATURE_ID>;

export const DEFAULT_F339_CONFIG: F339MapMaximumAPosterioriFaultDiagnosticianConfig = {
  featureId: F339_FEATURE_ID,
  stage: F339_STAGE,
  operationCode: F339_OPERATION_CODE,
  contractVersion: F339_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F339MapMaximumAPosterioriFaultDiagnosticianValidationError extends Error {
  public readonly featureId = F339_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F339 Validation Error on '${field}']: ${message}`);
    this.name = "F339MapMaximumAPosterioriFaultDiagnosticianValidationError";
    this.field = field;
  }
}

export function computeF339Digest(rawPayload: string): string {
  return `f339_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F339MapMaximumAPosterioriFaultDiagnosticianService extends KosmoraFeatureAdapterBase<
  typeof F339_FEATURE_ID,
  typeof F339_STAGE,
  typeof F339_OPERATION_CODE,
  F339MapMaximumAPosterioriFaultDiagnosticianConfig,
  F339MapMaximumAPosterioriFaultDiagnosticianInput,
  F339MapMaximumAPosterioriFaultDiagnosticianOutput
> {
  constructor(customConfig?: Partial<F339MapMaximumAPosterioriFaultDiagnosticianConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F339_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["map_hypothesis", "map_probability", "runner_up_gap", "confidence_tier"] as const,
      F339MapMaximumAPosterioriFaultDiagnosticianValidationError
    );
  }
}

export function verifyF339Module(): {
  readonly featureId: typeof F339_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F339MapMaximumAPosterioriFaultDiagnosticianService();
  const sampleInput: F339MapMaximumAPosterioriFaultDiagnosticianInput = {
    requestId: "req_verify_f339",
    projectId: "proj_kosmora_f339",
    workspaceId: "ws_kosmora_f339",
    tenantId: "tenant_rlm_f339",
    actorId: "actor_verifier_f339",
    autonomyLevel: "A3",
    map_hypothesis: "seed_f339_map_hypothesis",
    map_probability: 42,
    runner_up_gap: true,
    confidence_tier: "seed_f339_confidence_tier",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F339" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F339" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_map_hypothesis !== sampleInput.map_hypothesis &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F339] Verification failed`);
  }

  return {
    featureId: F339_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
