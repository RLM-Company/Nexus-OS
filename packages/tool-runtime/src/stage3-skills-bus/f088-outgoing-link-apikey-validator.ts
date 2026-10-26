/**
 * F088 (stage3-skills-bus): Валидатор исходящих ссылок и API-ключей
 * Проверка доступности эндпоинтов перед запуском длинной цепочки
 * Operation Code: preflight_endpoint_checker
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F088_FEATURE_ID = "F088" as const;
export const F088_STAGE = "stage3-skills-bus" as const;
export const F088_OPERATION_CODE = "preflight_endpoint_checker" as const;
export const F088_CONTRACT_VERSION = "2.0.0" as const;

export type F088OutgoingLinkApikeyValidatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F088OutgoingLinkApikeyValidatorConfig = BaseFeatureConfig<
  typeof F088_FEATURE_ID,
  typeof F088_STAGE,
  typeof F088_OPERATION_CODE
>;

export interface F088OutgoingLinkApikeyValidatorInput extends BaseFeatureInput {
  readonly endpoint_id: string;
  readonly key_format_valid: string | number;
  readonly reachable: string | number | boolean | readonly string[];
  readonly preflight_latency_ms: string | number | boolean | Record<string, unknown>;
}

export type F088OutgoingLinkApikeyValidatorAuditEntry = BaseFeatureAuditEntry<typeof F088_FEATURE_ID>;

export interface F088OutgoingLinkApikeyValidatorOutput {
  readonly featureId: typeof F088_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F088OutgoingLinkApikeyValidatorExecutionStatus;
  readonly operationCode: typeof F088_OPERATION_CODE;
  readonly resolved_endpoint_id: string;
  readonly resolved_key_format_valid: string | number;
  readonly resolved_reachable: string | number | boolean | readonly string[];
  readonly resolved_preflight_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F088OutgoingLinkApikeyValidatorAuditEntry;
}

export type F088OutgoingLinkApikeyValidatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F088_FEATURE_ID>;

export const DEFAULT_F088_CONFIG: F088OutgoingLinkApikeyValidatorConfig = {
  featureId: F088_FEATURE_ID,
  stage: F088_STAGE,
  operationCode: F088_OPERATION_CODE,
  contractVersion: F088_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F088OutgoingLinkApikeyValidatorValidationError extends Error {
  public readonly featureId = F088_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F088 Validation Error on '${field}']: ${message}`);
    this.name = "F088OutgoingLinkApikeyValidatorValidationError";
    this.field = field;
  }
}

export function computeF088Digest(rawPayload: string): string {
  return `f088_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F088OutgoingLinkApikeyValidatorEngine extends KosmoraFeatureAdapterBase<
  typeof F088_FEATURE_ID,
  typeof F088_STAGE,
  typeof F088_OPERATION_CODE,
  F088OutgoingLinkApikeyValidatorConfig,
  F088OutgoingLinkApikeyValidatorInput,
  F088OutgoingLinkApikeyValidatorOutput
> {
  constructor(customConfig?: Partial<F088OutgoingLinkApikeyValidatorConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F088_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["endpoint_id", "key_format_valid", "reachable", "preflight_latency_ms"] as const,
      F088OutgoingLinkApikeyValidatorValidationError
    );
  }
}

export function verifyF088Module(): {
  featureId: typeof F088_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F088OutgoingLinkApikeyValidatorEngine();
  const sampleInput: F088OutgoingLinkApikeyValidatorInput = {
    requestId: "req_verify_f088",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    endpoint_id: "f088_endpoint_id_seed",
    key_format_valid: 42,
    reachable: true,
    preflight_latency_ms: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 88 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F088" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_endpoint_id !== sampleInput.endpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F088_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
