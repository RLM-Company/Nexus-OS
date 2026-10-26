/**
 * F144 (stage5-enterprise): Регрессионное тестирование промптов и скиллов
 * Проверка того, что обновление системного промпта не ухудшило качество старых сценариев
 * Operation Code: prompt_regression_gate
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

export const F144_FEATURE_ID = "F144" as const;
export const F144_STAGE = "stage5-enterprise" as const;
export const F144_OPERATION_CODE = "prompt_regression_gate" as const;
export const F144_CONTRACT_VERSION = "2.0.0" as const;

export type F144PromptSkillRegressionTesterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F144PromptSkillRegressionTesterConfig = BaseFeatureConfig<
  typeof F144_FEATURE_ID,
  typeof F144_STAGE,
  typeof F144_OPERATION_CODE
>;

export interface F144PromptSkillRegressionTesterInput extends BaseFeatureInput {
  readonly baseline_version: string;
  readonly candidate_version: string | number;
  readonly drift_detected: string | number | boolean | readonly string[];
  readonly regression_passed: string | number | boolean | Record<string, unknown>;
}

export type F144PromptSkillRegressionTesterAuditEntry = BaseFeatureAuditEntry<typeof F144_FEATURE_ID>;

export interface F144PromptSkillRegressionTesterOutput {
  readonly featureId: typeof F144_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F144PromptSkillRegressionTesterExecutionStatus;
  readonly operationCode: typeof F144_OPERATION_CODE;
  readonly resolved_baseline_version: string;
  readonly resolved_candidate_version: string | number;
  readonly resolved_drift_detected: string | number | boolean | readonly string[];
  readonly resolved_regression_passed: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F144PromptSkillRegressionTesterAuditEntry;
}

export type F144PromptSkillRegressionTesterTelemetrySnapshot = BaseFeatureTelemetry<typeof F144_FEATURE_ID>;

export const DEFAULT_F144_CONFIG: F144PromptSkillRegressionTesterConfig = {
  featureId: F144_FEATURE_ID,
  stage: F144_STAGE,
  operationCode: F144_OPERATION_CODE,
  contractVersion: F144_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F144PromptSkillRegressionTesterValidationError extends Error {
  public readonly featureId = F144_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F144 Validation Error on '${field}']: ${message}`);
    this.name = "F144PromptSkillRegressionTesterValidationError";
    this.field = field;
  }
}

export function computeF144Digest(rawPayload: string): string {
  return `f144_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F144PromptSkillRegressionTesterEngine extends KosmoraFeatureAdapterBase<
  typeof F144_FEATURE_ID,
  typeof F144_STAGE,
  typeof F144_OPERATION_CODE,
  F144PromptSkillRegressionTesterConfig,
  F144PromptSkillRegressionTesterInput,
  F144PromptSkillRegressionTesterOutput
> {
  constructor(customConfig?: Partial<F144PromptSkillRegressionTesterConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F144_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["baseline_version", "candidate_version", "drift_detected", "regression_passed"] as const,
      F144PromptSkillRegressionTesterValidationError
    );
  }
}

export function verifyF144Module(): {
  featureId: typeof F144_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F144PromptSkillRegressionTesterEngine();
  const sampleInput: F144PromptSkillRegressionTesterInput = {
    requestId: "req_verify_f144",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    baseline_version: "f144_baseline_version_seed",
    candidate_version: 42,
    drift_detected: true,
    regression_passed: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 144 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F144" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_baseline_version !== sampleInput.baseline_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F144_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
