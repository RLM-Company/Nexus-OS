/**
 * F222 (stage7-formal-verification): Автоматический шлюз безопасности (Security Gate) для агентских патчей
 * Блокировка слияния кода при обнаружении хотя бы одного неочищенного пути от источника к опасному стоку
 * Operation Code: automated_security_gate_enforcer
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F222_FEATURE_ID = "F222" as const;
export const F222_STAGE = "stage7-formal-verification" as const;
export const F222_OPERATION_CODE = "automated_security_gate_enforcer" as const;
export const F222_CONTRACT_VERSION = "2.0.0" as const;

export type F222AutomatedSecurityGateEnforcerConfig = BaseFeatureConfig<
  typeof F222_FEATURE_ID,
  typeof F222_STAGE,
  typeof F222_OPERATION_CODE
>;

export interface F222AutomatedSecurityGateEnforcerInput extends BaseFeatureInput {
  readonly gate_decision: string | number | boolean | readonly string[];
  readonly unsafe_blocked: string | number | boolean | readonly string[];
  readonly sanitized_allowed: string | number | boolean | readonly string[];
  readonly gate_digest: string | number | boolean | readonly string[];
}

export interface F222AutomatedSecurityGateEnforcerOutput {
  readonly featureId: typeof F222_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F222_OPERATION_CODE;
  readonly resolved_gate_decision: unknown;
  readonly resolved_unsafe_blocked: unknown;
  readonly resolved_sanitized_allowed: unknown;
  readonly resolved_gate_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F222_FEATURE_ID>;
}

export type F222AutomatedSecurityGateEnforcerTelemetrySnapshot = BaseFeatureTelemetry<typeof F222_FEATURE_ID>;

export const DEFAULT_F222_CONFIG: F222AutomatedSecurityGateEnforcerConfig = {
  featureId: F222_FEATURE_ID,
  stage: F222_STAGE,
  operationCode: F222_OPERATION_CODE,
  contractVersion: F222_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F222AutomatedSecurityGateEnforcerValidationError extends Error {
  public readonly featureId = F222_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F222 Validation Error on '${field}']: ${message}`);
    this.name = "F222AutomatedSecurityGateEnforcerValidationError";
    this.field = field;
  }
}

export function computeF222Digest(rawPayload: string): string {
  return `f222_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F222AutomatedSecurityGateEnforcerService extends KosmoraFeatureAdapterBase<
  typeof F222_FEATURE_ID,
  typeof F222_STAGE,
  typeof F222_OPERATION_CODE,
  F222AutomatedSecurityGateEnforcerConfig,
  F222AutomatedSecurityGateEnforcerInput,
  F222AutomatedSecurityGateEnforcerOutput
> {
  constructor(customConfig?: Partial<F222AutomatedSecurityGateEnforcerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F222_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["gate_decision", "unsafe_blocked", "sanitized_allowed", "gate_digest"] as const,
      F222AutomatedSecurityGateEnforcerValidationError
    );
  }
}

export function verifyF222Module(): {
  readonly featureId: typeof F222_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F222AutomatedSecurityGateEnforcerService();
  const sampleInput: F222AutomatedSecurityGateEnforcerInput = {
    requestId: "req_verify_f222",
    projectId: "proj_kosmora_f222",
    workspaceId: "ws_kosmora_f222",
    tenantId: "tenant_rlm_f222",
    actorId: "actor_verifier_f222",
    autonomyLevel: "A3",
    gate_decision: "seed_f222_gate_decision",
    unsafe_blocked: 42,
    sanitized_allowed: true,
    gate_digest: "seed_f222_gate_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F222" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F222" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_gate_decision !== sampleInput.gate_decision &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F222] Verification failed`);
  }

  return {
    featureId: F222_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
