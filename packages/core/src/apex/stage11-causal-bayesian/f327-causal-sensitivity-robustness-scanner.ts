/**
 * F327 (stage11-causal-bayesian): Сканер устойчивости причинных выводов к скрытым конфаундерам
 * Оценка минимальной силы неучтённого фактора (E-value), способного обнулить наблюдаемый эффект
 * Operation Code: causal_sensitivity_scanner
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

export const F327_FEATURE_ID = "F327" as const;
export const F327_STAGE = "stage11-causal-bayesian" as const;
export const F327_OPERATION_CODE = "causal_sensitivity_scanner" as const;
export const F327_CONTRACT_VERSION = "2.0.0" as const;

export type F327CausalSensitivityRobustnessScannerConfig = BaseFeatureConfig<
  typeof F327_FEATURE_ID,
  typeof F327_STAGE,
  typeof F327_OPERATION_CODE
>;

export interface F327CausalSensitivityRobustnessScannerInput extends BaseFeatureInput {
  readonly estimated_ace: string | number | boolean | readonly string[];
  readonly unobserved_bound: string | number | boolean | readonly string[];
  readonly robustness_score: string | number | boolean | readonly string[];
  readonly verdict_stable: string | number | boolean | readonly string[];
}

export interface F327CausalSensitivityRobustnessScannerOutput {
  readonly featureId: typeof F327_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F327_OPERATION_CODE;
  readonly resolved_estimated_ace: unknown;
  readonly resolved_unobserved_bound: unknown;
  readonly resolved_robustness_score: unknown;
  readonly resolved_verdict_stable: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F327_FEATURE_ID>;
}

export type F327CausalSensitivityRobustnessScannerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F327_FEATURE_ID
>;

export const DEFAULT_F327_CONFIG: F327CausalSensitivityRobustnessScannerConfig = {
  featureId: F327_FEATURE_ID,
  stage: F327_STAGE,
  operationCode: F327_OPERATION_CODE,
  contractVersion: F327_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F327CausalSensitivityRobustnessScannerValidationError extends Error {
  public readonly featureId = F327_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F327 Validation Error on '${field}']: ${message}`);
    this.name = "F327CausalSensitivityRobustnessScannerValidationError";
    this.field = field;
  }
}

export function computeF327Digest(rawPayload: string): string {
  return `f327_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F327CausalSensitivityRobustnessScannerService extends KosmoraFeatureAdapterBase<
  typeof F327_FEATURE_ID,
  typeof F327_STAGE,
  typeof F327_OPERATION_CODE,
  F327CausalSensitivityRobustnessScannerConfig,
  F327CausalSensitivityRobustnessScannerInput,
  F327CausalSensitivityRobustnessScannerOutput
> {
  constructor(
    customConfig?: Partial<F327CausalSensitivityRobustnessScannerConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F327_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["estimated_ace", "unobserved_bound", "robustness_score", "verdict_stable"] as const,
      F327CausalSensitivityRobustnessScannerValidationError
    );
  }
}

export function verifyF327Module(): {
  readonly featureId: typeof F327_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F327CausalSensitivityRobustnessScannerService();
  const sampleInput: F327CausalSensitivityRobustnessScannerInput = {
    requestId: "req_verify_f327",
    projectId: "proj_kosmora_f327",
    workspaceId: "ws_kosmora_f327",
    tenantId: "tenant_rlm_f327",
    actorId: "actor_verifier_f327",
    autonomyLevel: "A3",
    estimated_ace: "seed_f327_estimated_ace",
    unobserved_bound: 42,
    robustness_score: true,
    verdict_stable: "seed_f327_verdict_stable",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F327" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F327" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_estimated_ace !== sampleInput.estimated_ace &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F327] Verification failed`);
  }

  return {
    featureId: F327_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
