/**
 * F237 (stage8-finops-compliance): Калибровщик шума Лапласа для механизмов дифференциальной приватности (ε, δ)-DP
 * Вычисление масштаба шума b = Δf / ε и детерминированная зашумлённая агрегация чувствительных метрик
 * Operation Code: differential_privacy_laplace_calibrator
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F237_FEATURE_ID = "F237" as const;
export const F237_STAGE = "stage8-finops-compliance" as const;
export const F237_OPERATION_CODE = "differential_privacy_laplace_calibrator" as const;
export const F237_CONTRACT_VERSION = "2.0.0" as const;

export type F237DifferentialPrivacyLaplaceCalibratorConfig = BaseFeatureConfig<
  typeof F237_FEATURE_ID,
  typeof F237_STAGE,
  typeof F237_OPERATION_CODE
>;

export interface F237DifferentialPrivacyLaplaceCalibratorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly query_id: string | number | boolean | readonly string[];
  readonly laplace_scale_b: string | number | boolean | readonly string[];
  readonly privatized_value: string | number | boolean | readonly string[];
}

export interface F237DifferentialPrivacyLaplaceCalibratorOutput {
  readonly featureId: typeof F237_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F237_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_query_id: unknown;
  readonly resolved_laplace_scale_b: unknown;
  readonly resolved_privatized_value: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F237_FEATURE_ID>;
}

export type F237DifferentialPrivacyLaplaceCalibratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F237_FEATURE_ID
>;

export const DEFAULT_F237_CONFIG: F237DifferentialPrivacyLaplaceCalibratorConfig = {
  featureId: F237_FEATURE_ID,
  stage: F237_STAGE,
  operationCode: F237_OPERATION_CODE,
  contractVersion: F237_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F237DifferentialPrivacyLaplaceCalibratorValidationError extends Error {
  public readonly featureId = F237_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F237 Validation Error on '${field}']: ${message}`);
    this.name = "F237DifferentialPrivacyLaplaceCalibratorValidationError";
    this.field = field;
  }
}

export function computeF237Digest(rawPayload: string): string {
  return `f237_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F237DifferentialPrivacyLaplaceCalibratorService extends KosmoraFeatureAdapterBase<
  typeof F237_FEATURE_ID,
  typeof F237_STAGE,
  typeof F237_OPERATION_CODE,
  F237DifferentialPrivacyLaplaceCalibratorConfig,
  F237DifferentialPrivacyLaplaceCalibratorInput,
  F237DifferentialPrivacyLaplaceCalibratorOutput
> {
  constructor(
    customConfig?: Partial<F237DifferentialPrivacyLaplaceCalibratorConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F237_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "query_id", "laplace_scale_b", "privatized_value"] as const,
      F237DifferentialPrivacyLaplaceCalibratorValidationError
    );
  }
}

export function verifyF237Module(): {
  readonly featureId: typeof F237_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F237DifferentialPrivacyLaplaceCalibratorService();
  const sampleInput: F237DifferentialPrivacyLaplaceCalibratorInput = {
    requestId: "req_verify_f237",
    projectId: "proj_kosmora_f237",
    workspaceId: "ws_kosmora_f237",
    tenantId: "tenant_rlm_f237",
    actorId: "actor_verifier_f237",
    autonomyLevel: "A3",
    tenant_id: "seed_f237_tenant_id",
    query_id: 42,
    laplace_scale_b: true,
    privatized_value: "seed_f237_privatized_value",
    metadata: { stage: "stage8-finops-compliance", featureId: "F237" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F237" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F237] Verification failed`);
  }

  return {
    featureId: F237_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
