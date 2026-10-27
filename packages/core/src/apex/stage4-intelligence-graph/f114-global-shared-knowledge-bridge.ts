/**
 * F114 (stage4-intelligence-graph): Глобальный мост знаний (Cross-Workspace Shared Library)
 * Опциональное подключение общих корпоративных справочников и стандартов ко всем проектам
 * Operation Code: shared_library_bridge
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

export const F114_FEATURE_ID = "F114" as const;
export const F114_STAGE = "stage4-intelligence-graph" as const;
export const F114_OPERATION_CODE = "shared_library_bridge" as const;
export const F114_CONTRACT_VERSION = "2.0.0" as const;

export type F114GlobalSharedKnowledgeBridgeExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F114GlobalSharedKnowledgeBridgeConfig = BaseFeatureConfig<
  typeof F114_FEATURE_ID,
  typeof F114_STAGE,
  typeof F114_OPERATION_CODE
>;

export interface F114GlobalSharedKnowledgeBridgeInput extends BaseFeatureInput {
  readonly library_id: string;
  readonly subscribed_workspaces: string | number;
  readonly shared_nodes_count: string | number | boolean | readonly string[];
  readonly read_only_mount: string | number | boolean | Record<string, unknown>;
}

export type F114GlobalSharedKnowledgeBridgeAuditEntry = BaseFeatureAuditEntry<
  typeof F114_FEATURE_ID
>;

export interface F114GlobalSharedKnowledgeBridgeOutput {
  readonly featureId: typeof F114_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F114GlobalSharedKnowledgeBridgeExecutionStatus;
  readonly operationCode: typeof F114_OPERATION_CODE;
  readonly resolved_library_id: string;
  readonly resolved_subscribed_workspaces: string | number;
  readonly resolved_shared_nodes_count: string | number | boolean | readonly string[];
  readonly resolved_read_only_mount: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F114GlobalSharedKnowledgeBridgeAuditEntry;
}

export type F114GlobalSharedKnowledgeBridgeTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F114_FEATURE_ID
>;

export const DEFAULT_F114_CONFIG: F114GlobalSharedKnowledgeBridgeConfig = {
  featureId: F114_FEATURE_ID,
  stage: F114_STAGE,
  operationCode: F114_OPERATION_CODE,
  contractVersion: F114_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F114GlobalSharedKnowledgeBridgeValidationError extends Error {
  public readonly featureId = F114_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F114 Validation Error on '${field}']: ${message}`);
    this.name = "F114GlobalSharedKnowledgeBridgeValidationError";
    this.field = field;
  }
}

export function computeF114Digest(rawPayload: string): string {
  return `f114_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F114GlobalSharedKnowledgeBridgeEngine extends KosmoraFeatureAdapterBase<
  typeof F114_FEATURE_ID,
  typeof F114_STAGE,
  typeof F114_OPERATION_CODE,
  F114GlobalSharedKnowledgeBridgeConfig,
  F114GlobalSharedKnowledgeBridgeInput,
  F114GlobalSharedKnowledgeBridgeOutput
> {
  constructor(
    customConfig?: Partial<F114GlobalSharedKnowledgeBridgeConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F114_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["library_id", "subscribed_workspaces", "shared_nodes_count", "read_only_mount"] as const,
      F114GlobalSharedKnowledgeBridgeValidationError
    );
  }
}

export function verifyF114Module(): {
  featureId: typeof F114_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F114GlobalSharedKnowledgeBridgeEngine();
  const sampleInput: F114GlobalSharedKnowledgeBridgeInput = {
    requestId: "req_verify_f114",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    library_id: "f114_library_id_seed",
    subscribed_workspaces: 42,
    shared_nodes_count: true,
    read_only_mount: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 114 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F114" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_library_id !== sampleInput.library_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F114_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
