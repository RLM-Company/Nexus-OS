/**
 * F124 (stage4-intelligence-graph): Ветвление чатов от любого сообщения (Conversation Forking)
 * Создание параллельной ветки обсуждения без потери исходного дерева диалога
 * Operation Code: chat_branch_forker
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

export const F124_FEATURE_ID = "F124" as const;
export const F124_STAGE = "stage4-intelligence-graph" as const;
export const F124_OPERATION_CODE = "chat_branch_forker" as const;
export const F124_CONTRACT_VERSION = "2.0.0" as const;

export type F124ConversationTreeForkingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F124ConversationTreeForkingConfig = BaseFeatureConfig<
  typeof F124_FEATURE_ID,
  typeof F124_STAGE,
  typeof F124_OPERATION_CODE
>;

export interface F124ConversationTreeForkingInput extends BaseFeatureInput {
  readonly parent_thread_id: string;
  readonly fork_message_id: string | number;
  readonly new_branch_id: string | number | boolean | readonly string[];
  readonly inherited_context_hash: string | number | boolean | Record<string, unknown>;
}

export type F124ConversationTreeForkingAuditEntry = BaseFeatureAuditEntry<typeof F124_FEATURE_ID>;

export interface F124ConversationTreeForkingOutput {
  readonly featureId: typeof F124_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F124ConversationTreeForkingExecutionStatus;
  readonly operationCode: typeof F124_OPERATION_CODE;
  readonly resolved_parent_thread_id: string;
  readonly resolved_fork_message_id: string | number;
  readonly resolved_new_branch_id: string | number | boolean | readonly string[];
  readonly resolved_inherited_context_hash: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F124ConversationTreeForkingAuditEntry;
}

export type F124ConversationTreeForkingTelemetrySnapshot = BaseFeatureTelemetry<typeof F124_FEATURE_ID>;

export const DEFAULT_F124_CONFIG: F124ConversationTreeForkingConfig = {
  featureId: F124_FEATURE_ID,
  stage: F124_STAGE,
  operationCode: F124_OPERATION_CODE,
  contractVersion: F124_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F124ConversationTreeForkingValidationError extends Error {
  public readonly featureId = F124_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F124 Validation Error on '${field}']: ${message}`);
    this.name = "F124ConversationTreeForkingValidationError";
    this.field = field;
  }
}

export function computeF124Digest(rawPayload: string): string {
  return `f124_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F124ConversationTreeForkingEngine extends KosmoraFeatureAdapterBase<
  typeof F124_FEATURE_ID,
  typeof F124_STAGE,
  typeof F124_OPERATION_CODE,
  F124ConversationTreeForkingConfig,
  F124ConversationTreeForkingInput,
  F124ConversationTreeForkingOutput
> {
  constructor(customConfig?: Partial<F124ConversationTreeForkingConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F124_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["parent_thread_id", "fork_message_id", "new_branch_id", "inherited_context_hash"] as const,
      F124ConversationTreeForkingValidationError
    );
  }
}

export function verifyF124Module(): {
  featureId: typeof F124_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F124ConversationTreeForkingEngine();
  const sampleInput: F124ConversationTreeForkingInput = {
    requestId: "req_verify_f124",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    parent_thread_id: "f124_parent_thread_id_seed",
    fork_message_id: 42,
    new_branch_id: true,
    inherited_context_hash: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 124 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F124" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parent_thread_id !== sampleInput.parent_thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F124_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
