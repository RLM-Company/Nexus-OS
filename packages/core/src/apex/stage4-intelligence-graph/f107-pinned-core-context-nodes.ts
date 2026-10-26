/**
 * F107 (stage4-intelligence-graph): Закрепление ядерных фактов (Pinned Context Nodes)
 * Фиксация неизменяемых правил проекта (стек, брендбук, ограничения), всегда присутствующих в контексте
 * Operation Code: pinned_fact_registry
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

export const F107_FEATURE_ID = "F107" as const;
export const F107_STAGE = "stage4-intelligence-graph" as const;
export const F107_OPERATION_CODE = "pinned_fact_registry" as const;
export const F107_CONTRACT_VERSION = "2.0.0" as const;

export type F107PinnedCoreContextNodesExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F107PinnedCoreContextNodesConfig = BaseFeatureConfig<
  typeof F107_FEATURE_ID,
  typeof F107_STAGE,
  typeof F107_OPERATION_CODE
>;

export interface F107PinnedCoreContextNodesInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly pinned_node_ids: string | number;
  readonly immutable_rules: string | number | boolean | readonly string[];
  readonly always_injected: string | number | boolean | Record<string, unknown>;
}

export type F107PinnedCoreContextNodesAuditEntry = BaseFeatureAuditEntry<typeof F107_FEATURE_ID>;

export interface F107PinnedCoreContextNodesOutput {
  readonly featureId: typeof F107_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F107PinnedCoreContextNodesExecutionStatus;
  readonly operationCode: typeof F107_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_pinned_node_ids: string | number;
  readonly resolved_immutable_rules: string | number | boolean | readonly string[];
  readonly resolved_always_injected: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F107PinnedCoreContextNodesAuditEntry;
}

export type F107PinnedCoreContextNodesTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F107_FEATURE_ID
>;

export const DEFAULT_F107_CONFIG: F107PinnedCoreContextNodesConfig = {
  featureId: F107_FEATURE_ID,
  stage: F107_STAGE,
  operationCode: F107_OPERATION_CODE,
  contractVersion: F107_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F107PinnedCoreContextNodesValidationError extends Error {
  public readonly featureId = F107_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F107 Validation Error on '${field}']: ${message}`);
    this.name = "F107PinnedCoreContextNodesValidationError";
    this.field = field;
  }
}

export function computeF107Digest(rawPayload: string): string {
  return `f107_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F107PinnedCoreContextNodesEngine extends KosmoraFeatureAdapterBase<
  typeof F107_FEATURE_ID,
  typeof F107_STAGE,
  typeof F107_OPERATION_CODE,
  F107PinnedCoreContextNodesConfig,
  F107PinnedCoreContextNodesInput,
  F107PinnedCoreContextNodesOutput
> {
  constructor(
    customConfig?: Partial<F107PinnedCoreContextNodesConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F107_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "pinned_node_ids", "immutable_rules", "always_injected"] as const,
      F107PinnedCoreContextNodesValidationError
    );
  }
}

export function verifyF107Module(): {
  featureId: typeof F107_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F107PinnedCoreContextNodesEngine();
  const sampleInput: F107PinnedCoreContextNodesInput = {
    requestId: "req_verify_f107",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f107_workspace_id_seed",
    pinned_node_ids: 42,
    immutable_rules: true,
    always_injected: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 107 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F107" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F107_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
