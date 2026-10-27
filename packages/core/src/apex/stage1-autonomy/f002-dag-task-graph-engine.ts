/**
 * F002 (stage1-autonomy): DAG-планировщик (Task Graph Engine)
 * Декомпозиция сложных промптов в направленный ациклический граф подзадач
 * Operation Code: dag_scheduler
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

export const F002_FEATURE_ID = "F002" as const;
export const F002_STAGE = "stage1-autonomy" as const;
export const F002_OPERATION_CODE = "dag_scheduler" as const;
export const F002_CONTRACT_VERSION = "2.0.0" as const;

export type F002DagTaskGraphEngineExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F002DagTaskGraphEngineConfig = BaseFeatureConfig<
  typeof F002_FEATURE_ID,
  typeof F002_STAGE,
  typeof F002_OPERATION_CODE
>;

export interface F002DagTaskGraphEngineInput extends BaseFeatureInput {
  readonly graph_id: string;
  readonly root_task_id: string | number;
  readonly topological_order: string | number | boolean | readonly string[];
  readonly acyclic_verified: string | number | boolean | Record<string, unknown>;
}

export type F002DagTaskGraphEngineAuditEntry = BaseFeatureAuditEntry<typeof F002_FEATURE_ID>;

export interface F002DagTaskGraphEngineOutput {
  readonly featureId: typeof F002_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F002DagTaskGraphEngineExecutionStatus;
  readonly operationCode: typeof F002_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_root_task_id: string | number;
  readonly resolved_topological_order: string | number | boolean | readonly string[];
  readonly resolved_acyclic_verified: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F002DagTaskGraphEngineAuditEntry;
}

export type F002DagTaskGraphEngineTelemetrySnapshot = BaseFeatureTelemetry<typeof F002_FEATURE_ID>;

export const DEFAULT_F002_CONFIG: F002DagTaskGraphEngineConfig = {
  featureId: F002_FEATURE_ID,
  stage: F002_STAGE,
  operationCode: F002_OPERATION_CODE,
  contractVersion: F002_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F002DagTaskGraphEngineValidationError extends Error {
  public readonly featureId = F002_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F002 Validation Error on '${field}']: ${message}`);
    this.name = "F002DagTaskGraphEngineValidationError";
    this.field = field;
  }
}

export function computeF002Digest(rawPayload: string): string {
  return `f002_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F002DagTaskGraphEngineEngine extends KosmoraFeatureAdapterBase<
  typeof F002_FEATURE_ID,
  typeof F002_STAGE,
  typeof F002_OPERATION_CODE,
  F002DagTaskGraphEngineConfig,
  F002DagTaskGraphEngineInput,
  F002DagTaskGraphEngineOutput
> {
  constructor(customConfig?: Partial<F002DagTaskGraphEngineConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F002_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["graph_id", "root_task_id", "topological_order", "acyclic_verified"] as const,
      F002DagTaskGraphEngineValidationError
    );
  }
}

export function verifyF002Module(): {
  featureId: typeof F002_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F002DagTaskGraphEngineEngine();
  const sampleInput: F002DagTaskGraphEngineInput = {
    requestId: "req_verify_f002",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f002_graph_id_seed",
    root_task_id: 42,
    topological_order: true,
    acyclic_verified: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 2 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F002" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F002_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
