/**
 * F332 (stage11-causal-bayesian): Вычислитель индивидуального эффекта воздействия (Individual Treatment Effect Prover)
 * Точная оценка выигрыша или потерь конкретного прогона DAG от выбора альтернативной модели
 * Operation Code: cf_ite_prover
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

export const F332_FEATURE_ID = "F332" as const;
export const F332_STAGE = "stage11-causal-bayesian" as const;
export const F332_OPERATION_CODE = "cf_ite_prover" as const;
export const F332_CONTRACT_VERSION = "2.0.0" as const;

export type F332IndividualTreatmentEffectIteProverConfig = BaseFeatureConfig<
  typeof F332_FEATURE_ID,
  typeof F332_STAGE,
  typeof F332_OPERATION_CODE
>;

export interface F332IndividualTreatmentEffectIteProverInput extends BaseFeatureInput {
  readonly run_id: string | number | boolean | readonly string[];
  readonly baseline_outcome: string | number | boolean | readonly string[];
  readonly alternate_outcome: string | number | boolean | readonly string[];
  readonly ite_delta: string | number | boolean | readonly string[];
}

export interface F332IndividualTreatmentEffectIteProverOutput {
  readonly featureId: typeof F332_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F332_OPERATION_CODE;
  readonly resolved_run_id: unknown;
  readonly resolved_baseline_outcome: unknown;
  readonly resolved_alternate_outcome: unknown;
  readonly resolved_ite_delta: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F332_FEATURE_ID>;
}

export type F332IndividualTreatmentEffectIteProverTelemetrySnapshot = BaseFeatureTelemetry<typeof F332_FEATURE_ID>;

export const DEFAULT_F332_CONFIG: F332IndividualTreatmentEffectIteProverConfig = {
  featureId: F332_FEATURE_ID,
  stage: F332_STAGE,
  operationCode: F332_OPERATION_CODE,
  contractVersion: F332_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F332IndividualTreatmentEffectIteProverValidationError extends Error {
  public readonly featureId = F332_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F332 Validation Error on '${field}']: ${message}`);
    this.name = "F332IndividualTreatmentEffectIteProverValidationError";
    this.field = field;
  }
}

export function computeF332Digest(rawPayload: string): string {
  return `f332_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F332IndividualTreatmentEffectIteProverService extends KosmoraFeatureAdapterBase<
  typeof F332_FEATURE_ID,
  typeof F332_STAGE,
  typeof F332_OPERATION_CODE,
  F332IndividualTreatmentEffectIteProverConfig,
  F332IndividualTreatmentEffectIteProverInput,
  F332IndividualTreatmentEffectIteProverOutput
> {
  constructor(customConfig?: Partial<F332IndividualTreatmentEffectIteProverConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F332_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["run_id", "baseline_outcome", "alternate_outcome", "ite_delta"] as const,
      F332IndividualTreatmentEffectIteProverValidationError
    );
  }
}

export function verifyF332Module(): {
  readonly featureId: typeof F332_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F332IndividualTreatmentEffectIteProverService();
  const sampleInput: F332IndividualTreatmentEffectIteProverInput = {
    requestId: "req_verify_f332",
    projectId: "proj_kosmora_f332",
    workspaceId: "ws_kosmora_f332",
    tenantId: "tenant_rlm_f332",
    actorId: "actor_verifier_f332",
    autonomyLevel: "A3",
    run_id: "seed_f332_run_id",
    baseline_outcome: 42,
    alternate_outcome: true,
    ite_delta: "seed_f332_ite_delta",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F332" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F332" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_run_id !== sampleInput.run_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F332] Verification failed`);
  }

  return {
    featureId: F332_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
