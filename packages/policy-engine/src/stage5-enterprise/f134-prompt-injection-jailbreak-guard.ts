/**
 * F134 (stage5-enterprise): Защита от Prompt Injection и Jailbreak
 * Входной фильтр, блокирующий попытки переопределить системные инструкции через файлы или веб
 * Operation Code: injection_shield_filter
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F134_FEATURE_ID = "F134" as const;
export const F134_STAGE = "stage5-enterprise" as const;
export const F134_OPERATION_CODE = "injection_shield_filter" as const;
export const F134_CONTRACT_VERSION = "2.0.0" as const;

export type F134PromptInjectionJailbreakGuardExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F134PromptInjectionJailbreakGuardConfig = BaseFeatureConfig<
  typeof F134_FEATURE_ID,
  typeof F134_STAGE,
  typeof F134_OPERATION_CODE
>;

export interface F134PromptInjectionJailbreakGuardInput extends BaseFeatureInput {
  readonly source_channel: string;
  readonly threat_signature_detected: string | number;
  readonly blocked_execution: string | number | boolean | readonly string[];
  readonly sanitized_input: string | number | boolean | Record<string, unknown>;
}

export type F134PromptInjectionJailbreakGuardAuditEntry = BaseFeatureAuditEntry<typeof F134_FEATURE_ID>;

export interface F134PromptInjectionJailbreakGuardOutput {
  readonly featureId: typeof F134_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F134PromptInjectionJailbreakGuardExecutionStatus;
  readonly operationCode: typeof F134_OPERATION_CODE;
  readonly resolved_source_channel: string;
  readonly resolved_threat_signature_detected: string | number;
  readonly resolved_blocked_execution: string | number | boolean | readonly string[];
  readonly resolved_sanitized_input: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F134PromptInjectionJailbreakGuardAuditEntry;
}

export type F134PromptInjectionJailbreakGuardTelemetrySnapshot = BaseFeatureTelemetry<typeof F134_FEATURE_ID>;

export const DEFAULT_F134_CONFIG: F134PromptInjectionJailbreakGuardConfig = {
  featureId: F134_FEATURE_ID,
  stage: F134_STAGE,
  operationCode: F134_OPERATION_CODE,
  contractVersion: F134_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F134PromptInjectionJailbreakGuardValidationError extends Error {
  public readonly featureId = F134_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F134 Validation Error on '${field}']: ${message}`);
    this.name = "F134PromptInjectionJailbreakGuardValidationError";
    this.field = field;
  }
}

export function computeF134Digest(rawPayload: string): string {
  return `f134_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F134PromptInjectionJailbreakGuardEngine extends KosmoraFeatureAdapterBase<
  typeof F134_FEATURE_ID,
  typeof F134_STAGE,
  typeof F134_OPERATION_CODE,
  F134PromptInjectionJailbreakGuardConfig,
  F134PromptInjectionJailbreakGuardInput,
  F134PromptInjectionJailbreakGuardOutput
> {
  constructor(customConfig?: Partial<F134PromptInjectionJailbreakGuardConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F134_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["source_channel", "threat_signature_detected", "blocked_execution", "sanitized_input"] as const,
      F134PromptInjectionJailbreakGuardValidationError
    );
  }
}

export function verifyF134Module(): {
  featureId: typeof F134_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F134PromptInjectionJailbreakGuardEngine();
  const sampleInput: F134PromptInjectionJailbreakGuardInput = {
    requestId: "req_verify_f134",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_channel: "f134_source_channel_seed",
    threat_signature_detected: 42,
    blocked_execution: true,
    sanitized_input: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 134 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F134" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_channel !== sampleInput.source_channel &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F134_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
