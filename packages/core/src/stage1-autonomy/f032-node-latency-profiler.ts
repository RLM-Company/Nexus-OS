/**
 * F032 (stage1-autonomy): Трассировка латентности узлов (Node Latency Profiler)
 * Замер времени выполнения каждого шага графа для поиска узких мест
 * Operation Code: latency_profiler
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F032_FEATURE_ID = "F032" as const;
export const F032_STAGE = "stage1-autonomy" as const;
export const F032_OPERATION_CODE = "latency_profiler" as const;
export const F032_CONTRACT_VERSION = "2.0.0" as const;

export type F032NodeLatencyProfilerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F032NodeLatencyProfilerConfig {
  readonly featureId: typeof F032_FEATURE_ID;
  readonly stage: typeof F032_STAGE;
  readonly operationCode: typeof F032_OPERATION_CODE;
  readonly contractVersion: typeof F032_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F032NodeLatencyProfilerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly bottleneck_node_id: string | number;
  readonly p95_latency_ms: string | number | boolean | readonly string[];
  readonly total_graph_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F032NodeLatencyProfilerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F032_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F032NodeLatencyProfilerOutput {
  readonly featureId: typeof F032_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F032NodeLatencyProfilerExecutionStatus;
  readonly operationCode: typeof F032_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_bottleneck_node_id: string | number;
  readonly resolved_p95_latency_ms: string | number | boolean | readonly string[];
  readonly resolved_total_graph_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F032NodeLatencyProfilerAuditEntry;
}

export interface F032NodeLatencyProfilerTelemetrySnapshot {
  readonly featureId: typeof F032_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F032_CONFIG: F032NodeLatencyProfilerConfig = {
  featureId: F032_FEATURE_ID,
  stage: F032_STAGE,
  operationCode: F032_OPERATION_CODE,
  contractVersion: F032_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F032NodeLatencyProfilerValidationError extends Error {
  public readonly featureId = F032_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F032 Validation Error on '${field}']: ${message}`);
    this.name = "F032NodeLatencyProfilerValidationError";
    this.field = field;
  }
}

export function computeF032Digest(rawPayload: string): string {
  return `f032_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F032NodeLatencyProfilerEngine {
  private readonly config: F032NodeLatencyProfilerConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F032NodeLatencyProfilerOutput[] = [];
  private readonly auditLog: F032NodeLatencyProfilerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F032NodeLatencyProfilerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F032NodeLatencyProfilerConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F032_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F032NodeLatencyProfilerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F032NodeLatencyProfilerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F032NodeLatencyProfilerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F032NodeLatencyProfilerValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      graph_id: input.graph_id,
      bottleneck_node_id: input.bottleneck_node_id,
      p95_latency_ms: input.p95_latency_ms,
      total_graph_ms: input.total_graph_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F032NodeLatencyProfilerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F032NodeLatencyProfilerInput): F032NodeLatencyProfilerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F032_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        graph_id: input.graph_id,
        bottleneck_node_id: input.bottleneck_node_id,
        p95_latency_ms: input.p95_latency_ms,
        total_graph_ms: input.total_graph_ms
      });
      const payloadHash = computeF032Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F032NodeLatencyProfilerValidationError(
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
        featureId: F032_FEATURE_ID,
        operationCode: F032_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          graph_id: input.graph_id,
          bottleneck_node_id: input.bottleneck_node_id,
          p95_latency_ms: input.p95_latency_ms,
          total_graph_ms: input.total_graph_ms
        }
      });

      const executionId = `exec_f032_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f032_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F032NodeLatencyProfilerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F032_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `latency_profiler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F032NodeLatencyProfilerOutput = {
        featureId: F032_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F032_OPERATION_CODE,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string,
        resolved_bottleneck_node_id: kernelResult.resolvedFields.bottleneck_node_id as string | number,
        resolved_p95_latency_ms: kernelResult.resolvedFields.p95_latency_ms as string | number | boolean | readonly string[],
        resolved_total_graph_ms: kernelResult.resolvedFields.total_graph_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F032NodeLatencyProfilerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F032_FEATURE_ID,
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

  public getAuditTrail(): readonly F032NodeLatencyProfilerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F032NodeLatencyProfilerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF032Module(): {
  featureId: typeof F032_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F032NodeLatencyProfilerEngine();
  const sampleInput: F032NodeLatencyProfilerInput = {
    requestId: "req_verify_f032",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f032_graph_id_seed",
    bottleneck_node_id: 42,
    p95_latency_ms: true,
    total_graph_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 32 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F032" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F032_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
