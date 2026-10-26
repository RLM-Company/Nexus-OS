/**
 * F020 (stage1-autonomy): Горячая замена промптов ролей
 * Обновление системных инструкций агентов без перезапуска рантайма
 * Operation Code: prompt_hotswap
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

export const F020_FEATURE_ID = "F020" as const;
export const F020_STAGE = "stage1-autonomy" as const;
export const F020_OPERATION_CODE = "prompt_hotswap" as const;
export const F020_CONTRACT_VERSION = "2.0.0" as const;

export type F020HotSwapRolePromptsExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F020HotSwapRolePromptsConfig = BaseFeatureConfig<
  typeof F020_FEATURE_ID,
  typeof F020_STAGE,
  typeof F020_OPERATION_CODE
>;

export interface F020HotSwapRolePromptsInput extends BaseFeatureInput {
  readonly role_name: string;
  readonly previous_version: string | number;
  readonly active_version: string | number | boolean | readonly string[];
  readonly zero_downtime_applied: string | number | boolean | Record<string, unknown>;
}

export type F020HotSwapRolePromptsAuditEntry = BaseFeatureAuditEntry<typeof F020_FEATURE_ID>;

export interface F020HotSwapRolePromptsOutput {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F020HotSwapRolePromptsExecutionStatus;
  readonly operationCode: typeof F020_OPERATION_CODE;
  readonly resolved_role_name: string;
  readonly resolved_previous_version: string | number;
  readonly resolved_active_version: string | number | boolean | readonly string[];
  readonly resolved_zero_downtime_applied: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F020HotSwapRolePromptsAuditEntry;
}

export type F020HotSwapRolePromptsTelemetrySnapshot = BaseFeatureTelemetry<typeof F020_FEATURE_ID>;

export const DEFAULT_F020_CONFIG: F020HotSwapRolePromptsConfig = {
  featureId: F020_FEATURE_ID,
  stage: F020_STAGE,
  operationCode: F020_OPERATION_CODE,
  contractVersion: F020_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F020HotSwapRolePromptsValidationError extends Error {
  public readonly featureId = F020_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F020 Validation Error on '${field}']: ${message}`);
    this.name = "F020HotSwapRolePromptsValidationError";
    this.field = field;
  }
}

export function computeF020Digest(rawPayload: string): string {
  return `f020_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F020HotSwapRolePromptsEngine extends KosmoraFeatureAdapterBase<
  typeof F020_FEATURE_ID,
  typeof F020_STAGE,
  typeof F020_OPERATION_CODE,
  F020HotSwapRolePromptsConfig,
  F020HotSwapRolePromptsInput,
  F020HotSwapRolePromptsOutput
> {
  constructor(customConfig?: Partial<F020HotSwapRolePromptsConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F020_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["role_name", "previous_version", "active_version", "zero_downtime_applied"] as const,
      F020HotSwapRolePromptsValidationError
    );
  }
}

export function verifyF020Module(): {
  featureId: typeof F020_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F020HotSwapRolePromptsEngine();
  const sampleInput: F020HotSwapRolePromptsInput = {
    requestId: "req_verify_f020",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    role_name: "f020_role_name_seed",
    previous_version: 42,
    active_version: true,
    zero_downtime_applied: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 20 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F020" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_role_name !== sampleInput.role_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F020_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
