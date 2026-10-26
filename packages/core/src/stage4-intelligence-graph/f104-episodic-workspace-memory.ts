/**
 * F104 (stage4-intelligence-graph): Долгосрочная эпизодическая память воркспейса
 * Сохранение ключевых архитектурных решений и выводов прошлых недель
 * Operation Code: episodic_decision_store
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

export const F104_FEATURE_ID = "F104" as const;
export const F104_STAGE = "stage4-intelligence-graph" as const;
export const F104_OPERATION_CODE = "episodic_decision_store" as const;
export const F104_CONTRACT_VERSION = "2.0.0" as const;

export type F104EpisodicWorkspaceMemoryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F104EpisodicWorkspaceMemoryConfig = BaseFeatureConfig<
  typeof F104_FEATURE_ID,
  typeof F104_STAGE,
  typeof F104_OPERATION_CODE
>;

export interface F104EpisodicWorkspaceMemoryInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly episode_id: string | number;
  readonly architectural_decision: string | number | boolean | readonly string[];
  readonly retention_priority: string | number | boolean | Record<string, unknown>;
}

export type F104EpisodicWorkspaceMemoryAuditEntry = BaseFeatureAuditEntry<typeof F104_FEATURE_ID>;

export interface F104EpisodicWorkspaceMemoryOutput {
  readonly featureId: typeof F104_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F104EpisodicWorkspaceMemoryExecutionStatus;
  readonly operationCode: typeof F104_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_episode_id: string | number;
  readonly resolved_architectural_decision: string | number | boolean | readonly string[];
  readonly resolved_retention_priority: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F104EpisodicWorkspaceMemoryAuditEntry;
}

export type F104EpisodicWorkspaceMemoryTelemetrySnapshot = BaseFeatureTelemetry<typeof F104_FEATURE_ID>;

export const DEFAULT_F104_CONFIG: F104EpisodicWorkspaceMemoryConfig = {
  featureId: F104_FEATURE_ID,
  stage: F104_STAGE,
  operationCode: F104_OPERATION_CODE,
  contractVersion: F104_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F104EpisodicWorkspaceMemoryValidationError extends Error {
  public readonly featureId = F104_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F104 Validation Error on '${field}']: ${message}`);
    this.name = "F104EpisodicWorkspaceMemoryValidationError";
    this.field = field;
  }
}

export function computeF104Digest(rawPayload: string): string {
  return `f104_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F104EpisodicWorkspaceMemoryEngine extends KosmoraFeatureAdapterBase<
  typeof F104_FEATURE_ID,
  typeof F104_STAGE,
  typeof F104_OPERATION_CODE,
  F104EpisodicWorkspaceMemoryConfig,
  F104EpisodicWorkspaceMemoryInput,
  F104EpisodicWorkspaceMemoryOutput
> {
  constructor(customConfig?: Partial<F104EpisodicWorkspaceMemoryConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F104_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "episode_id", "architectural_decision", "retention_priority"] as const,
      F104EpisodicWorkspaceMemoryValidationError
    );
  }
}

export function verifyF104Module(): {
  featureId: typeof F104_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F104EpisodicWorkspaceMemoryEngine();
  const sampleInput: F104EpisodicWorkspaceMemoryInput = {
    requestId: "req_verify_f104",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f104_workspace_id_seed",
    episode_id: 42,
    architectural_decision: true,
    retention_priority: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 104 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F104" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F104_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
