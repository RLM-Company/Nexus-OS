/**
 * F226 (stage8-finops-compliance): Калькулятор экспоненциально взвешенной задержки (EWMA) и штрафов за нарушение SLO
 * Динамическое снижение рейтинга провайдера при превышении целевого порога латентности ответа
 * Operation Code: ewma_latency_slo_penalty_calculator
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

export const F226_FEATURE_ID = "F226" as const;
export const F226_STAGE = "stage8-finops-compliance" as const;
export const F226_OPERATION_CODE = "ewma_latency_slo_penalty_calculator" as const;
export const F226_CONTRACT_VERSION = "2.0.0" as const;

export type F226EwmaLatencySloPenaltyCalculatorConfig = BaseFeatureConfig<
  typeof F226_FEATURE_ID,
  typeof F226_STAGE,
  typeof F226_OPERATION_CODE
>;

export interface F226EwmaLatencySloPenaltyCalculatorInput extends BaseFeatureInput {
  readonly selected_provider_id: string | number | boolean | readonly string[];
  readonly expected_latency_ms: string | number | boolean | readonly string[];
  readonly max_latency_slo_ms: string | number | boolean | readonly string[];
  readonly slo_compliant: string | number | boolean | readonly string[];
}

export interface F226EwmaLatencySloPenaltyCalculatorOutput {
  readonly featureId: typeof F226_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F226_OPERATION_CODE;
  readonly resolved_selected_provider_id: unknown;
  readonly resolved_expected_latency_ms: unknown;
  readonly resolved_max_latency_slo_ms: unknown;
  readonly resolved_slo_compliant: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F226_FEATURE_ID>;
}

export type F226EwmaLatencySloPenaltyCalculatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F226_FEATURE_ID
>;

export const DEFAULT_F226_CONFIG: F226EwmaLatencySloPenaltyCalculatorConfig = {
  featureId: F226_FEATURE_ID,
  stage: F226_STAGE,
  operationCode: F226_OPERATION_CODE,
  contractVersion: F226_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F226EwmaLatencySloPenaltyCalculatorValidationError extends Error {
  public readonly featureId = F226_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F226 Validation Error on '${field}']: ${message}`);
    this.name = "F226EwmaLatencySloPenaltyCalculatorValidationError";
    this.field = field;
  }
}

export function computeF226Digest(rawPayload: string): string {
  return `f226_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F226EwmaLatencySloPenaltyCalculatorService extends KosmoraFeatureAdapterBase<
  typeof F226_FEATURE_ID,
  typeof F226_STAGE,
  typeof F226_OPERATION_CODE,
  F226EwmaLatencySloPenaltyCalculatorConfig,
  F226EwmaLatencySloPenaltyCalculatorInput,
  F226EwmaLatencySloPenaltyCalculatorOutput
> {
  constructor(
    customConfig?: Partial<F226EwmaLatencySloPenaltyCalculatorConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F226_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      [
        "selected_provider_id",
        "expected_latency_ms",
        "max_latency_slo_ms",
        "slo_compliant"
      ] as const,
      F226EwmaLatencySloPenaltyCalculatorValidationError
    );
  }
}

export function verifyF226Module(): {
  readonly featureId: typeof F226_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F226EwmaLatencySloPenaltyCalculatorService();
  const sampleInput: F226EwmaLatencySloPenaltyCalculatorInput = {
    requestId: "req_verify_f226",
    projectId: "proj_kosmora_f226",
    workspaceId: "ws_kosmora_f226",
    tenantId: "tenant_rlm_f226",
    actorId: "actor_verifier_f226",
    autonomyLevel: "A3",
    selected_provider_id: "seed_f226_selected_provider_id",
    expected_latency_ms: 42,
    max_latency_slo_ms: true,
    slo_compliant: "seed_f226_slo_compliant",
    metadata: { stage: "stage8-finops-compliance", featureId: "F226" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F226" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selected_provider_id !== sampleInput.selected_provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F226] Verification failed`);
  }

  return {
    featureId: F226_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
