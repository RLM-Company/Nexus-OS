/**
 * F058 (stage2-canvas): Автоматическая проверка битых ссылок и сносок
 * Валидация всех цитат и источников внутри сгенерированного отчёта
 * Operation Code: citation_link_checker
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F058_FEATURE_ID = "F058" as const;
export const F058_STAGE = "stage2-canvas" as const;
export const F058_OPERATION_CODE = "citation_link_checker" as const;
export const F058_CONTRACT_VERSION = "2.0.0" as const;

export type F058BrokenLinkCitationValidatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F058BrokenLinkCitationValidatorConfig = BaseFeatureConfig<
  typeof F058_FEATURE_ID,
  typeof F058_STAGE,
  typeof F058_OPERATION_CODE
>;

export interface F058BrokenLinkCitationValidatorInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly total_links_checked: string | number;
  readonly broken_urls: string | number | boolean | readonly string[];
  readonly all_citations_valid: string | number | boolean | Record<string, unknown>;
}

export type F058BrokenLinkCitationValidatorAuditEntry = BaseFeatureAuditEntry<typeof F058_FEATURE_ID>;

export interface F058BrokenLinkCitationValidatorOutput {
  readonly featureId: typeof F058_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F058BrokenLinkCitationValidatorExecutionStatus;
  readonly operationCode: typeof F058_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_total_links_checked: string | number;
  readonly resolved_broken_urls: string | number | boolean | readonly string[];
  readonly resolved_all_citations_valid: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F058BrokenLinkCitationValidatorAuditEntry;
}

export type F058BrokenLinkCitationValidatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F058_FEATURE_ID>;

export const DEFAULT_F058_CONFIG: F058BrokenLinkCitationValidatorConfig = {
  featureId: F058_FEATURE_ID,
  stage: F058_STAGE,
  operationCode: F058_OPERATION_CODE,
  contractVersion: F058_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F058BrokenLinkCitationValidatorValidationError extends Error {
  public readonly featureId = F058_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F058 Validation Error on '${field}']: ${message}`);
    this.name = "F058BrokenLinkCitationValidatorValidationError";
    this.field = field;
  }
}

export function computeF058Digest(rawPayload: string): string {
  return `f058_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F058BrokenLinkCitationValidatorEngine extends KosmoraFeatureAdapterBase<
  typeof F058_FEATURE_ID,
  typeof F058_STAGE,
  typeof F058_OPERATION_CODE,
  F058BrokenLinkCitationValidatorConfig,
  F058BrokenLinkCitationValidatorInput,
  F058BrokenLinkCitationValidatorOutput
> {
  constructor(customConfig?: Partial<F058BrokenLinkCitationValidatorConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F058_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "total_links_checked", "broken_urls", "all_citations_valid"] as const,
      F058BrokenLinkCitationValidatorValidationError
    );
  }
}

export function verifyF058Module(): {
  featureId: typeof F058_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F058BrokenLinkCitationValidatorEngine();
  const sampleInput: F058BrokenLinkCitationValidatorInput = {
    requestId: "req_verify_f058",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f058_artifact_id_seed",
    total_links_checked: 42,
    broken_urls: true,
    all_citations_valid: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 58 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F058" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F058_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
