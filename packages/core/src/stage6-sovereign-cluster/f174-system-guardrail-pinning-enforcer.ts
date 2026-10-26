/**
 * F174 (stage6-sovereign-cluster): Невытесняемое закрепление системных политик безопасности
 * Защита системных директив и ограничений безопасности от вытеснения при переполнении окна контекста
 * Operation Code: system_guardrail_pinning_enforcer
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F174_FEATURE_ID = "F174" as const;
export const F174_STAGE = "stage6-sovereign-cluster" as const;
export const F174_OPERATION_CODE = "system_guardrail_pinning_enforcer" as const;
export const F174_CONTRACT_VERSION = "2.0.0" as const;

export type F174SystemGuardrailPinningEnforcerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F174SystemGuardrailPinningEnforcerConfig = BaseFeatureConfig<
  typeof F174_FEATURE_ID,
  typeof F174_STAGE,
  typeof F174_OPERATION_CODE
>;

export interface F174SystemGuardrailPinningEnforcerInput extends BaseFeatureInput {
  readonly pinned_system_segments: string;
  readonly used_tokens: string | number;
  readonly max_token_budget: string | number | boolean | readonly string[];
  readonly guardrail_intact: string | number | boolean | Record<string, unknown>;
}

export type F174SystemGuardrailPinningEnforcerAuditEntry = BaseFeatureAuditEntry<typeof F174_FEATURE_ID>;

export interface F174SystemGuardrailPinningEnforcerOutput {
  readonly featureId: typeof F174_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F174SystemGuardrailPinningEnforcerExecutionStatus;
  readonly operationCode: typeof F174_OPERATION_CODE;
  readonly resolved_pinned_system_segments: string;
  readonly resolved_used_tokens: string | number;
  readonly resolved_max_token_budget: string | number | boolean | readonly string[];
  readonly resolved_guardrail_intact: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F174SystemGuardrailPinningEnforcerAuditEntry;
}

export type F174SystemGuardrailPinningEnforcerTelemetrySnapshot = BaseFeatureTelemetry<typeof F174_FEATURE_ID>;

export const DEFAULT_F174_CONFIG: F174SystemGuardrailPinningEnforcerConfig = {
  featureId: F174_FEATURE_ID,
  stage: F174_STAGE,
  operationCode: F174_OPERATION_CODE,
  contractVersion: F174_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F174SystemGuardrailPinningEnforcerValidationError extends Error {
  public readonly featureId = F174_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F174 Validation Error on '${field}']: ${message}`);
    this.name = "F174SystemGuardrailPinningEnforcerValidationError";
    this.field = field;
  }
}

export function computeF174Digest(rawPayload: string): string {
  return `f174_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F174SystemGuardrailPinningEnforcerEngine extends KosmoraFeatureAdapterBase<
  typeof F174_FEATURE_ID,
  typeof F174_STAGE,
  typeof F174_OPERATION_CODE,
  F174SystemGuardrailPinningEnforcerConfig,
  F174SystemGuardrailPinningEnforcerInput,
  F174SystemGuardrailPinningEnforcerOutput
> {
  constructor(customConfig?: Partial<F174SystemGuardrailPinningEnforcerConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F174_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["pinned_system_segments", "used_tokens", "max_token_budget", "guardrail_intact"] as const,
      F174SystemGuardrailPinningEnforcerValidationError
    );
  }
}

export function verifyF174Module(): {
  featureId: typeof F174_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F174SystemGuardrailPinningEnforcerEngine();
  const sampleInput: F174SystemGuardrailPinningEnforcerInput = {
    requestId: "req_verify_f174",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    pinned_system_segments: "f174_pinned_system_segments_seed",
    used_tokens: 42,
    max_token_budget: true,
    guardrail_intact: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 174 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F174" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_pinned_system_segments !== sampleInput.pinned_system_segments &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F174_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
