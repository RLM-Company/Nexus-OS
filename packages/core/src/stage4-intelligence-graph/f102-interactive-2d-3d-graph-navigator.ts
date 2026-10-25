/**
 * F102 (stage4-intelligence-graph): Интерактивный 2D/3D-навигатор по графу знаний
 * Визуальный осмотр связей проекта с фильтрацией по типам узлов, датам и тегам
 * Operation Code: graph_viewport_serializer
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

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

export interface F102Interactive2d3dGraphNavigatorConfig {
  readonly featureId: typeof F102_FEATURE_ID;
  readonly stage: typeof F102_STAGE;
  readonly operationCode: typeof F102_OPERATION_CODE;
  readonly contractVersion: typeof F102_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F102Interactive2d3dGraphNavigatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly view_mode: string;
  readonly visible_nodes: string | number;
  readonly visible_edges: string | number | boolean | readonly string[];
  readonly camera_coordinates: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F102Interactive2d3dGraphNavigatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F102_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

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

export interface F102Interactive2d3dGraphNavigatorTelemetrySnapshot {
  readonly featureId: typeof F102_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

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

export class F102Interactive2d3dGraphNavigatorEngine {
  private readonly config: F102Interactive2d3dGraphNavigatorConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F102Interactive2d3dGraphNavigatorOutput[] = [];
  private readonly auditLog: F102Interactive2d3dGraphNavigatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F102Interactive2d3dGraphNavigatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F102Interactive2d3dGraphNavigatorConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F102_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F102Interactive2d3dGraphNavigatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F102Interactive2d3dGraphNavigatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.view_mode).trim().length === 0) {
      throw new F102Interactive2d3dGraphNavigatorValidationError("view_mode", "Primary domain attribute 'view_mode' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      view_mode: input.view_mode,
      visible_nodes: input.visible_nodes,
      visible_edges: input.visible_edges,
      camera_coordinates: input.camera_coordinates
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F102Interactive2d3dGraphNavigatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F102Interactive2d3dGraphNavigatorInput): F102Interactive2d3dGraphNavigatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F102_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        view_mode: input.view_mode,
        visible_nodes: input.visible_nodes,
        visible_edges: input.visible_edges,
        camera_coordinates: input.camera_coordinates
      });
      const payloadHash = computeF102Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F102Interactive2d3dGraphNavigatorValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F102_FEATURE_ID,
        operationCode: F102_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          view_mode: input.view_mode,
          visible_nodes: input.visible_nodes,
          visible_edges: input.visible_edges,
          camera_coordinates: input.camera_coordinates
        }
      });

      const executionId = `exec_f102_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f102_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F102Interactive2d3dGraphNavigatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F102_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `graph_viewport_serializer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F102Interactive2d3dGraphNavigatorOutput = {
        featureId: F102_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F102_OPERATION_CODE,
        resolved_view_mode: kernelResult.resolvedFields.view_mode as string,
        resolved_visible_nodes: kernelResult.resolvedFields.visible_nodes as string | number,
        resolved_visible_edges: kernelResult.resolvedFields.visible_edges as string | number | boolean | readonly string[],
        resolved_camera_coordinates: kernelResult.resolvedFields.camera_coordinates as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F102Interactive2d3dGraphNavigatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F102_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0
    };
  }

  public getAuditTrail(): readonly F102Interactive2d3dGraphNavigatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F102Interactive2d3dGraphNavigatorOutput[] {
    return [...this.executionHistory];
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
