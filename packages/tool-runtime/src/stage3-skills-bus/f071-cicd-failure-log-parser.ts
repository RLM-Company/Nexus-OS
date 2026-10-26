/**
 * F071 (stage3-skills-bus): Автоматический парсинг логов упавших CI/CD пайплайнов
 * Чтение ошибок GitHub Actions и генерация патча для починки сборки
 * Operation Code: ci_log_diagnostics
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

export const F071_FEATURE_ID = "F071" as const;
export const F071_STAGE = "stage3-skills-bus" as const;
export const F071_OPERATION_CODE = "ci_log_diagnostics" as const;
export const F071_CONTRACT_VERSION = "2.0.0" as const;

export type F071CicdFailureLogParserExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F071CicdFailureLogParserConfig = BaseFeatureConfig<
  typeof F071_FEATURE_ID,
  typeof F071_STAGE,
  typeof F071_OPERATION_CODE
>;

export interface F071CicdFailureLogParserInput extends BaseFeatureInput {
  readonly workflow_run_id: string;
  readonly error_code: string | number;
  readonly failing_file: string | number | boolean | readonly string[];
  readonly auto_patch_diff: string | number | boolean | Record<string, unknown>;
}

export type F071CicdFailureLogParserAuditEntry = BaseFeatureAuditEntry<typeof F071_FEATURE_ID>;

export interface F071CicdFailureLogParserOutput {
  readonly featureId: typeof F071_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F071CicdFailureLogParserExecutionStatus;
  readonly operationCode: typeof F071_OPERATION_CODE;
  readonly resolved_workflow_run_id: string;
  readonly resolved_error_code: string | number;
  readonly resolved_failing_file: string | number | boolean | readonly string[];
  readonly resolved_auto_patch_diff: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F071CicdFailureLogParserAuditEntry;
}

export type F071CicdFailureLogParserTelemetrySnapshot = BaseFeatureTelemetry<typeof F071_FEATURE_ID>;

export const DEFAULT_F071_CONFIG: F071CicdFailureLogParserConfig = {
  featureId: F071_FEATURE_ID,
  stage: F071_STAGE,
  operationCode: F071_OPERATION_CODE,
  contractVersion: F071_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F071CicdFailureLogParserValidationError extends Error {
  public readonly featureId = F071_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F071 Validation Error on '${field}']: ${message}`);
    this.name = "F071CicdFailureLogParserValidationError";
    this.field = field;
  }
}

export function computeF071Digest(rawPayload: string): string {
  return `f071_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F071CicdFailureLogParserEngine extends KosmoraFeatureAdapterBase<
  typeof F071_FEATURE_ID,
  typeof F071_STAGE,
  typeof F071_OPERATION_CODE,
  F071CicdFailureLogParserConfig,
  F071CicdFailureLogParserInput,
  F071CicdFailureLogParserOutput
> {
  constructor(customConfig?: Partial<F071CicdFailureLogParserConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F071_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["workflow_run_id", "error_code", "failing_file", "auto_patch_diff"] as const,
      F071CicdFailureLogParserValidationError
    );
  }
}

export function verifyF071Module(): {
  featureId: typeof F071_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F071CicdFailureLogParserEngine();
  const sampleInput: F071CicdFailureLogParserInput = {
    requestId: "req_verify_f071",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workflow_run_id: "f071_workflow_run_id_seed",
    error_code: 42,
    failing_file: true,
    auto_patch_diff: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 71 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F071" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workflow_run_id !== sampleInput.workflow_run_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F071_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
