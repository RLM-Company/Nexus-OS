/**
 * F219 (stage7-formal-verification): Верификатор корректного применения функций санитизации (escapeSql, sanitizeHtml)
 * Подтверждение того, что недоверенный ввод прошёл через утверждённый санитайзер перед попаданием в сток
 * Operation Code: sanitizer_effectiveness_verifier
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

export const F219_FEATURE_ID = "F219" as const;
export const F219_STAGE = "stage7-formal-verification" as const;
export const F219_OPERATION_CODE = "sanitizer_effectiveness_verifier" as const;
export const F219_CONTRACT_VERSION = "2.0.0" as const;

export type F219SanitizerEffectivenessVerifierConfig = BaseFeatureConfig<
  typeof F219_FEATURE_ID,
  typeof F219_STAGE,
  typeof F219_OPERATION_CODE
>;

export interface F219SanitizerEffectivenessVerifierInput extends BaseFeatureInput {
  readonly safe: string | number | boolean | readonly string[];
  readonly sanitized_variables: string | number | boolean | readonly string[];
  readonly violations_count: string | number | boolean | readonly string[];
  readonly analysis_digest: string | number | boolean | readonly string[];
}

export interface F219SanitizerEffectivenessVerifierOutput {
  readonly featureId: typeof F219_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F219_OPERATION_CODE;
  readonly resolved_safe: unknown;
  readonly resolved_sanitized_variables: unknown;
  readonly resolved_violations_count: unknown;
  readonly resolved_analysis_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F219_FEATURE_ID>;
}

export type F219SanitizerEffectivenessVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F219_FEATURE_ID
>;

export const DEFAULT_F219_CONFIG: F219SanitizerEffectivenessVerifierConfig = {
  featureId: F219_FEATURE_ID,
  stage: F219_STAGE,
  operationCode: F219_OPERATION_CODE,
  contractVersion: F219_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F219SanitizerEffectivenessVerifierValidationError extends Error {
  public readonly featureId = F219_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F219 Validation Error on '${field}']: ${message}`);
    this.name = "F219SanitizerEffectivenessVerifierValidationError";
    this.field = field;
  }
}

export function computeF219Digest(rawPayload: string): string {
  return `f219_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F219SanitizerEffectivenessVerifierService extends KosmoraFeatureAdapterBase<
  typeof F219_FEATURE_ID,
  typeof F219_STAGE,
  typeof F219_OPERATION_CODE,
  F219SanitizerEffectivenessVerifierConfig,
  F219SanitizerEffectivenessVerifierInput,
  F219SanitizerEffectivenessVerifierOutput
> {
  constructor(
    customConfig?: Partial<F219SanitizerEffectivenessVerifierConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F219_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["safe", "sanitized_variables", "violations_count", "analysis_digest"] as const,
      F219SanitizerEffectivenessVerifierValidationError
    );
  }
}

export function verifyF219Module(): {
  readonly featureId: typeof F219_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F219SanitizerEffectivenessVerifierService();
  const sampleInput: F219SanitizerEffectivenessVerifierInput = {
    requestId: "req_verify_f219",
    projectId: "proj_kosmora_f219",
    workspaceId: "ws_kosmora_f219",
    tenantId: "tenant_rlm_f219",
    actorId: "actor_verifier_f219",
    autonomyLevel: "A3",
    safe: "seed_f219_safe",
    sanitized_variables: 42,
    violations_count: true,
    analysis_digest: "seed_f219_analysis_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F219" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F219" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_safe !== sampleInput.safe &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F219] Verification failed`);
  }

  return {
    featureId: F219_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
