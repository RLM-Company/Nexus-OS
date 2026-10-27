/**
 * F098 (stage4-intelligence-graph): Слои графа знаний (Intelligence Graph Layers)
 * Разделение графа на слои: документов, задач, кодовых модулей и бизнес-сущностей
 * Operation Code: multilayer_graph_partition
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

export const F098_FEATURE_ID = "F098" as const;
export const F098_STAGE = "stage4-intelligence-graph" as const;
export const F098_OPERATION_CODE = "multilayer_graph_partition" as const;
export const F098_CONTRACT_VERSION = "2.0.0" as const;

export type F098IntelligenceGraphLayersExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F098IntelligenceGraphLayersConfig = BaseFeatureConfig<
  typeof F098_FEATURE_ID,
  typeof F098_STAGE,
  typeof F098_OPERATION_CODE
>;

export interface F098IntelligenceGraphLayersInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly document_nodes: string | number;
  readonly task_nodes: string | number | boolean | readonly string[];
  readonly code_and_entity_nodes: string | number | boolean | Record<string, unknown>;
}

export type F098IntelligenceGraphLayersAuditEntry = BaseFeatureAuditEntry<typeof F098_FEATURE_ID>;

export interface F098IntelligenceGraphLayersOutput {
  readonly featureId: typeof F098_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F098IntelligenceGraphLayersExecutionStatus;
  readonly operationCode: typeof F098_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_document_nodes: string | number;
  readonly resolved_task_nodes: string | number | boolean | readonly string[];
  readonly resolved_code_and_entity_nodes: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F098IntelligenceGraphLayersAuditEntry;
}

export type F098IntelligenceGraphLayersTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F098_FEATURE_ID
>;

export const DEFAULT_F098_CONFIG: F098IntelligenceGraphLayersConfig = {
  featureId: F098_FEATURE_ID,
  stage: F098_STAGE,
  operationCode: F098_OPERATION_CODE,
  contractVersion: F098_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F098IntelligenceGraphLayersValidationError extends Error {
  public readonly featureId = F098_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F098 Validation Error on '${field}']: ${message}`);
    this.name = "F098IntelligenceGraphLayersValidationError";
    this.field = field;
  }
}

export function computeF098Digest(rawPayload: string): string {
  return `f098_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F098IntelligenceGraphLayersEngine extends KosmoraFeatureAdapterBase<
  typeof F098_FEATURE_ID,
  typeof F098_STAGE,
  typeof F098_OPERATION_CODE,
  F098IntelligenceGraphLayersConfig,
  F098IntelligenceGraphLayersInput,
  F098IntelligenceGraphLayersOutput
> {
  constructor(
    customConfig?: Partial<F098IntelligenceGraphLayersConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F098_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "document_nodes", "task_nodes", "code_and_entity_nodes"] as const,
      F098IntelligenceGraphLayersValidationError
    );
  }
}

export function verifyF098Module(): {
  featureId: typeof F098_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F098IntelligenceGraphLayersEngine();
  const sampleInput: F098IntelligenceGraphLayersInput = {
    requestId: "req_verify_f098",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f098_workspace_id_seed",
    document_nodes: 42,
    task_nodes: true,
    code_and_entity_nodes: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 98 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F098" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F098_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
