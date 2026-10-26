/**
 * F042 (stage2-canvas): Рендеринг архитектурных диаграмм (Mermaid / D2 / Flow)
 * Интерактивная отрисовка блок-схем и графов с зумом и экспортом в SVG/PNG
 * Operation Code: diagram_renderer
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F042_FEATURE_ID = "F042" as const;
export const F042_STAGE = "stage2-canvas" as const;
export const F042_OPERATION_CODE = "diagram_renderer" as const;
export const F042_CONTRACT_VERSION = "2.0.0" as const;

export type F042ArchitecturalDiagramRendererExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F042ArchitecturalDiagramRendererConfig = BaseFeatureConfig<
  typeof F042_FEATURE_ID,
  typeof F042_STAGE,
  typeof F042_OPERATION_CODE
>;

export interface F042ArchitecturalDiagramRendererInput extends BaseFeatureInput {
  readonly diagram_id: string;
  readonly dsl_engine: string | number;
  readonly nodes_rendered: string | number | boolean | readonly string[];
  readonly svg_payload: string | number | boolean | Record<string, unknown>;
}

export type F042ArchitecturalDiagramRendererAuditEntry = BaseFeatureAuditEntry<typeof F042_FEATURE_ID>;

export interface F042ArchitecturalDiagramRendererOutput {
  readonly featureId: typeof F042_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F042ArchitecturalDiagramRendererExecutionStatus;
  readonly operationCode: typeof F042_OPERATION_CODE;
  readonly resolved_diagram_id: string;
  readonly resolved_dsl_engine: string | number;
  readonly resolved_nodes_rendered: string | number | boolean | readonly string[];
  readonly resolved_svg_payload: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F042ArchitecturalDiagramRendererAuditEntry;
}

export type F042ArchitecturalDiagramRendererTelemetrySnapshot = BaseFeatureTelemetry<typeof F042_FEATURE_ID>;

export const DEFAULT_F042_CONFIG: F042ArchitecturalDiagramRendererConfig = {
  featureId: F042_FEATURE_ID,
  stage: F042_STAGE,
  operationCode: F042_OPERATION_CODE,
  contractVersion: F042_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F042ArchitecturalDiagramRendererValidationError extends Error {
  public readonly featureId = F042_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F042 Validation Error on '${field}']: ${message}`);
    this.name = "F042ArchitecturalDiagramRendererValidationError";
    this.field = field;
  }
}

export function computeF042Digest(rawPayload: string): string {
  return `f042_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F042ArchitecturalDiagramRendererEngine extends KosmoraFeatureAdapterBase<
  typeof F042_FEATURE_ID,
  typeof F042_STAGE,
  typeof F042_OPERATION_CODE,
  F042ArchitecturalDiagramRendererConfig,
  F042ArchitecturalDiagramRendererInput,
  F042ArchitecturalDiagramRendererOutput
> {
  constructor(customConfig?: Partial<F042ArchitecturalDiagramRendererConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F042_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["diagram_id", "dsl_engine", "nodes_rendered", "svg_payload"] as const,
      F042ArchitecturalDiagramRendererValidationError
    );
  }
}

export function verifyF042Module(): {
  featureId: typeof F042_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F042ArchitecturalDiagramRendererEngine();
  const sampleInput: F042ArchitecturalDiagramRendererInput = {
    requestId: "req_verify_f042",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    diagram_id: "f042_diagram_id_seed",
    dsl_engine: 42,
    nodes_rendered: true,
    svg_payload: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 42 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F042" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_diagram_id !== sampleInput.diagram_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F042_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
