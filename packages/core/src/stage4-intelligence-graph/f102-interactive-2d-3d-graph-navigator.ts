/**
 * F102 (stage4-intelligence-graph): Интерактивный 2D/3D-навигатор по графу знаний
 * Визуальный осмотр связей проекта с фильтрацией по типам узлов, датам и тегам
 * Operation Code: graph_viewport_serializer
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

export const F102_FEATURE_ID = "F102" as const;
export const F102_STAGE = "stage4-intelligence-graph" as const;
export const F102_OPERATION_CODE = "graph_viewport_serializer" as const;
export const F102_CONTRACT_VERSION = "2.0.0" as const;

export type F102Interactive2d3dGraphNavigatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F102Interactive2d3dGraphNavigatorConfig = BaseFeatureConfig<
  typeof F102_FEATURE_ID,
  typeof F102_STAGE,
  typeof F102_OPERATION_CODE
>;

export interface F102Interactive2d3dGraphNavigatorInput extends BaseFeatureInput {
  readonly view_mode: string;
  readonly visible_nodes: string | number;
  readonly visible_edges: string | number | boolean | readonly string[];
  readonly camera_coordinates: string | number | boolean | Record<string, unknown>;
}

export type F102Interactive2d3dGraphNavigatorAuditEntry = BaseFeatureAuditEntry<typeof F102_FEATURE_ID>;

export interface F102Interactive2d3dGraphNavigatorOutput {
  readonly featureId: typeof F102_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F102Interactive2d3dGraphNavigatorExecutionStatus;
  readonly operationCode: typeof F102_OPERATION_CODE;
  readonly resolved_view_mode: string;
  readonly resolved_visible_nodes: string | number;
  readonly resolved_visible_edges: string | number | boolean | readonly string[];
  readonly resolved_camera_coordinates: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F102Interactive2d3dGraphNavigatorAuditEntry;
}

export type F102Interactive2d3dGraphNavigatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F102_FEATURE_ID>;

export const DEFAULT_F102_CONFIG: F102Interactive2d3dGraphNavigatorConfig = {
  featureId: F102_FEATURE_ID,
  stage: F102_STAGE,
  operationCode: F102_OPERATION_CODE,
  contractVersion: F102_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F102Interactive2d3dGraphNavigatorValidationError extends Error {
  public readonly featureId = F102_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F102 Validation Error on '${field}']: ${message}`);
    this.name = "F102Interactive2d3dGraphNavigatorValidationError";
    this.field = field;
  }
}

export function computeF102Digest(rawPayload: string): string {
  return `f102_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F102Interactive2d3dGraphNavigatorEngine extends KosmoraFeatureAdapterBase<
  typeof F102_FEATURE_ID,
  typeof F102_STAGE,
  typeof F102_OPERATION_CODE,
  F102Interactive2d3dGraphNavigatorConfig,
  F102Interactive2d3dGraphNavigatorInput,
  F102Interactive2d3dGraphNavigatorOutput
> {
  constructor(customConfig?: Partial<F102Interactive2d3dGraphNavigatorConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F102_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["view_mode", "visible_nodes", "visible_edges", "camera_coordinates"] as const,
      F102Interactive2d3dGraphNavigatorValidationError
    );
  }
}

export function verifyF102Module(): {
  featureId: typeof F102_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F102Interactive2d3dGraphNavigatorEngine();
  const sampleInput: F102Interactive2d3dGraphNavigatorInput = {
    requestId: "req_verify_f102",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    view_mode: "f102_view_mode_seed",
    visible_nodes: 42,
    visible_edges: true,
    camera_coordinates: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 102 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F102" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_view_mode !== sampleInput.view_mode &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F102_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
