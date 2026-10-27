/**
 * F117 (stage4-intelligence-graph): Импорт и экспорт подграфов знаний (JSON-LD / GraphML)
 * Перенос накопленной базы знаний проекта между инстансами
 * Operation Code: subgraph_serializer
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

export const F117_FEATURE_ID = "F117" as const;
export const F117_STAGE = "stage4-intelligence-graph" as const;
export const F117_OPERATION_CODE = "subgraph_serializer" as const;
export const F117_CONTRACT_VERSION = "2.0.0" as const;

export type F117SubgraphJsonldGraphmlPorterExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F117SubgraphJsonldGraphmlPorterConfig = BaseFeatureConfig<
  typeof F117_FEATURE_ID,
  typeof F117_STAGE,
  typeof F117_OPERATION_CODE
>;

export interface F117SubgraphJsonldGraphmlPorterInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly export_format: string | number;
  readonly serialized_nodes: string | number | boolean | readonly string[];
  readonly portable_payload: string | number | boolean | Record<string, unknown>;
}

export type F117SubgraphJsonldGraphmlPorterAuditEntry = BaseFeatureAuditEntry<
  typeof F117_FEATURE_ID
>;

export interface F117SubgraphJsonldGraphmlPorterOutput {
  readonly featureId: typeof F117_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F117SubgraphJsonldGraphmlPorterExecutionStatus;
  readonly operationCode: typeof F117_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_export_format: string | number;
  readonly resolved_serialized_nodes: string | number | boolean | readonly string[];
  readonly resolved_portable_payload: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F117SubgraphJsonldGraphmlPorterAuditEntry;
}

export type F117SubgraphJsonldGraphmlPorterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F117_FEATURE_ID
>;

export const DEFAULT_F117_CONFIG: F117SubgraphJsonldGraphmlPorterConfig = {
  featureId: F117_FEATURE_ID,
  stage: F117_STAGE,
  operationCode: F117_OPERATION_CODE,
  contractVersion: F117_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F117SubgraphJsonldGraphmlPorterValidationError extends Error {
  public readonly featureId = F117_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F117 Validation Error on '${field}']: ${message}`);
    this.name = "F117SubgraphJsonldGraphmlPorterValidationError";
    this.field = field;
  }
}

export function computeF117Digest(rawPayload: string): string {
  return `f117_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F117SubgraphJsonldGraphmlPorterEngine extends KosmoraFeatureAdapterBase<
  typeof F117_FEATURE_ID,
  typeof F117_STAGE,
  typeof F117_OPERATION_CODE,
  F117SubgraphJsonldGraphmlPorterConfig,
  F117SubgraphJsonldGraphmlPorterInput,
  F117SubgraphJsonldGraphmlPorterOutput
> {
  constructor(
    customConfig?: Partial<F117SubgraphJsonldGraphmlPorterConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F117_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "export_format", "serialized_nodes", "portable_payload"] as const,
      F117SubgraphJsonldGraphmlPorterValidationError
    );
  }
}

export function verifyF117Module(): {
  featureId: typeof F117_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F117SubgraphJsonldGraphmlPorterEngine();
  const sampleInput: F117SubgraphJsonldGraphmlPorterInput = {
    requestId: "req_verify_f117",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f117_workspace_id_seed",
    export_format: 42,
    serialized_nodes: true,
    portable_payload: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 117 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F117" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F117_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
