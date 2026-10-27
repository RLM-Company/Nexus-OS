/**
 * F123 (stage4-intelligence-graph): Персональный профиль предпочтений внутри воркспейса
 * Запоминание любимого формата таблиц, стиля кода и лаконичности ответов
 * Operation Code: preference_memory_profile
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F123_FEATURE_ID = "F123" as const;
export const F123_STAGE = "stage4-intelligence-graph" as const;
export const F123_OPERATION_CODE = "preference_memory_profile" as const;
export const F123_CONTRACT_VERSION = "2.0.0" as const;

export type F123WorkspacePreferenceProfilerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F123WorkspacePreferenceProfilerConfig = BaseFeatureConfig<
  typeof F123_FEATURE_ID,
  typeof F123_STAGE,
  typeof F123_OPERATION_CODE
>;

export interface F123WorkspacePreferenceProfilerInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly preferred_table_style: string | number;
  readonly preferred_code_idiom: string | number | boolean | readonly string[];
  readonly verbosity_level: string | number | boolean | Record<string, unknown>;
}

export type F123WorkspacePreferenceProfilerAuditEntry = BaseFeatureAuditEntry<
  typeof F123_FEATURE_ID
>;

export interface F123WorkspacePreferenceProfilerOutput {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F123WorkspacePreferenceProfilerExecutionStatus;
  readonly operationCode: typeof F123_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_preferred_table_style: string | number;
  readonly resolved_preferred_code_idiom: string | number | boolean | readonly string[];
  readonly resolved_verbosity_level: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F123WorkspacePreferenceProfilerAuditEntry;
}

export type F123WorkspacePreferenceProfilerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F123_FEATURE_ID
>;

export const DEFAULT_F123_CONFIG: F123WorkspacePreferenceProfilerConfig = {
  featureId: F123_FEATURE_ID,
  stage: F123_STAGE,
  operationCode: F123_OPERATION_CODE,
  contractVersion: F123_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F123WorkspacePreferenceProfilerValidationError extends Error {
  public readonly featureId = F123_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F123 Validation Error on '${field}']: ${message}`);
    this.name = "F123WorkspacePreferenceProfilerValidationError";
    this.field = field;
  }
}

export function computeF123Digest(rawPayload: string): string {
  return `f123_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F123WorkspacePreferenceProfilerEngine extends KosmoraFeatureAdapterBase<
  typeof F123_FEATURE_ID,
  typeof F123_STAGE,
  typeof F123_OPERATION_CODE,
  F123WorkspacePreferenceProfilerConfig,
  F123WorkspacePreferenceProfilerInput,
  F123WorkspacePreferenceProfilerOutput
> {
  constructor(
    customConfig?: Partial<F123WorkspacePreferenceProfilerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F123_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "preferred_table_style", "preferred_code_idiom", "verbosity_level"] as const,
      F123WorkspacePreferenceProfilerValidationError
    );
  }
}

export function verifyF123Module(): {
  featureId: typeof F123_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F123WorkspacePreferenceProfilerEngine();
  const sampleInput: F123WorkspacePreferenceProfilerInput = {
    requestId: "req_verify_f123",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f123_workspace_id_seed",
    preferred_table_style: 42,
    preferred_code_idiom: true,
    verbosity_level: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 123 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F123" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F123_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
