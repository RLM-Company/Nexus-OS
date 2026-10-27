/**
 * F016 (stage1-autonomy): Самоисправление синтаксиса (Self-Healing Retry)
 * Автоматический перезапрос при битом JSON или ошибке компиляции без участия человека
 * Operation Code: self_healing_retry
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F016_FEATURE_ID = "F016" as const;
export const F016_STAGE = "stage1-autonomy" as const;
export const F016_OPERATION_CODE = "self_healing_retry" as const;
export const F016_CONTRACT_VERSION = "2.0.0" as const;

export type F016SelfHealingSyntaxRetryExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F016SelfHealingSyntaxRetryConfig = BaseFeatureConfig<
  typeof F016_FEATURE_ID,
  typeof F016_STAGE,
  typeof F016_OPERATION_CODE
>;

export interface F016SelfHealingSyntaxRetryInput extends BaseFeatureInput {
  readonly attempt_number: string;
  readonly syntax_repaired: string | number;
  readonly extracted_json: string | number | boolean | readonly string[];
  readonly diagnostic_delta: string | number | boolean | Record<string, unknown>;
}

export type F016SelfHealingSyntaxRetryAuditEntry = BaseFeatureAuditEntry<typeof F016_FEATURE_ID>;

export interface F016SelfHealingSyntaxRetryOutput {
  readonly featureId: typeof F016_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F016SelfHealingSyntaxRetryExecutionStatus;
  readonly operationCode: typeof F016_OPERATION_CODE;
  readonly resolved_attempt_number: string;
  readonly resolved_syntax_repaired: string | number;
  readonly resolved_extracted_json: string | number | boolean | readonly string[];
  readonly resolved_diagnostic_delta: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F016SelfHealingSyntaxRetryAuditEntry;
}

export type F016SelfHealingSyntaxRetryTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F016_FEATURE_ID
>;

export const DEFAULT_F016_CONFIG: F016SelfHealingSyntaxRetryConfig = {
  featureId: F016_FEATURE_ID,
  stage: F016_STAGE,
  operationCode: F016_OPERATION_CODE,
  contractVersion: F016_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F016SelfHealingSyntaxRetryValidationError extends Error {
  public readonly featureId = F016_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F016 Validation Error on '${field}']: ${message}`);
    this.name = "F016SelfHealingSyntaxRetryValidationError";
    this.field = field;
  }
}

export function computeF016Digest(rawPayload: string): string {
  return `f016_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F016SelfHealingSyntaxRetryEngine extends KosmoraFeatureAdapterBase<
  typeof F016_FEATURE_ID,
  typeof F016_STAGE,
  typeof F016_OPERATION_CODE,
  F016SelfHealingSyntaxRetryConfig,
  F016SelfHealingSyntaxRetryInput,
  F016SelfHealingSyntaxRetryOutput
> {
  constructor(
    customConfig?: Partial<F016SelfHealingSyntaxRetryConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F016_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["attempt_number", "syntax_repaired", "extracted_json", "diagnostic_delta"] as const,
      F016SelfHealingSyntaxRetryValidationError
    );
  }
}

export function verifyF016Module(): {
  featureId: typeof F016_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F016SelfHealingSyntaxRetryEngine();
  const sampleInput: F016SelfHealingSyntaxRetryInput = {
    requestId: "req_verify_f016",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    attempt_number: "f016_attempt_number_seed",
    syntax_repaired: 42,
    extracted_json: true,
    diagnostic_delta: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 16 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F016" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_attempt_number !== sampleInput.attempt_number &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F016_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
