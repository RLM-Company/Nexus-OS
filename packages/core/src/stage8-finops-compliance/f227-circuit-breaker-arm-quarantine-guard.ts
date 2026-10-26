/**
 * F227 (stage8-finops-compliance): Автоматический прерыватель цепи (Circuit Breaker) для нестабильных LLM-эндпоинтов
 * Размыкание цепи и перевод трафика на резервные модели после серии последовательных сбоев провайдера
 * Operation Code: circuit_breaker_arm_quarantine_guard
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

export const F227_FEATURE_ID = "F227" as const;
export const F227_STAGE = "stage8-finops-compliance" as const;
export const F227_OPERATION_CODE = "circuit_breaker_arm_quarantine_guard" as const;
export const F227_CONTRACT_VERSION = "2.0.0" as const;

export type F227CircuitBreakerArmQuarantineGuardConfig = BaseFeatureConfig<
  typeof F227_FEATURE_ID,
  typeof F227_STAGE,
  typeof F227_OPERATION_CODE
>;

export interface F227CircuitBreakerArmQuarantineGuardInput extends BaseFeatureInput {
  readonly quarantined_provider_id: string | number | boolean | readonly string[];
  readonly circuit_open: string | number | boolean | readonly string[];
  readonly active_fallback_provider_id: string | number | boolean | readonly string[];
  readonly failover_verified: string | number | boolean | readonly string[];
}

export interface F227CircuitBreakerArmQuarantineGuardOutput {
  readonly featureId: typeof F227_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F227_OPERATION_CODE;
  readonly resolved_quarantined_provider_id: unknown;
  readonly resolved_circuit_open: unknown;
  readonly resolved_active_fallback_provider_id: unknown;
  readonly resolved_failover_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F227_FEATURE_ID>;
}

export type F227CircuitBreakerArmQuarantineGuardTelemetrySnapshot = BaseFeatureTelemetry<typeof F227_FEATURE_ID>;

export const DEFAULT_F227_CONFIG: F227CircuitBreakerArmQuarantineGuardConfig = {
  featureId: F227_FEATURE_ID,
  stage: F227_STAGE,
  operationCode: F227_OPERATION_CODE,
  contractVersion: F227_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F227CircuitBreakerArmQuarantineGuardValidationError extends Error {
  public readonly featureId = F227_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F227 Validation Error on '${field}']: ${message}`);
    this.name = "F227CircuitBreakerArmQuarantineGuardValidationError";
    this.field = field;
  }
}

export function computeF227Digest(rawPayload: string): string {
  return `f227_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F227CircuitBreakerArmQuarantineGuardService extends KosmoraFeatureAdapterBase<
  typeof F227_FEATURE_ID,
  typeof F227_STAGE,
  typeof F227_OPERATION_CODE,
  F227CircuitBreakerArmQuarantineGuardConfig,
  F227CircuitBreakerArmQuarantineGuardInput,
  F227CircuitBreakerArmQuarantineGuardOutput
> {
  constructor(customConfig?: Partial<F227CircuitBreakerArmQuarantineGuardConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F227_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["quarantined_provider_id", "circuit_open", "active_fallback_provider_id", "failover_verified"] as const,
      F227CircuitBreakerArmQuarantineGuardValidationError
    );
  }
}

export function verifyF227Module(): {
  readonly featureId: typeof F227_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F227CircuitBreakerArmQuarantineGuardService();
  const sampleInput: F227CircuitBreakerArmQuarantineGuardInput = {
    requestId: "req_verify_f227",
    projectId: "proj_kosmora_f227",
    workspaceId: "ws_kosmora_f227",
    tenantId: "tenant_rlm_f227",
    actorId: "actor_verifier_f227",
    autonomyLevel: "A3",
    quarantined_provider_id: "seed_f227_quarantined_provider_id",
    circuit_open: 42,
    active_fallback_provider_id: true,
    failover_verified: "seed_f227_failover_verified",
    metadata: { stage: "stage8-finops-compliance", featureId: "F227" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F227" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_quarantined_provider_id !== sampleInput.quarantined_provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F227] Verification failed`);
  }

  return {
    featureId: F227_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
