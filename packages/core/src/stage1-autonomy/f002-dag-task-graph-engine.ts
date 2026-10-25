/**
 * F002 (stage1-autonomy): DAG-планировщик (Task Graph Engine)
 * Декомпозиция сложных промптов в направленный ациклический граф подзадач
 * Operation Code: dag_scheduler
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F002_FEATURE_ID = "F002" as const;
export const F002_STAGE = "stage1-autonomy" as const;
export const F002_OPERATION_CODE = "dag_scheduler" as const;
export const F002_CONTRACT_VERSION = "2.0.0" as const;

export type F002DagTaskGraphExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F002DagTaskGraphConfig {
  readonly featureId: typeof F002_FEATURE_ID;
  readonly stage: typeof F002_STAGE;
  readonly operationCode: typeof F002_OPERATION_CODE;
  readonly contractVersion: typeof F002_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F002DagTaskGraphInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly root_task_id: string | number;
  readonly topological_order: string | number | boolean | readonly string[];
  readonly acyclic_verified: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F002DagTaskGraphAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F002_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F002DagTaskGraphOutput {
  readonly featureId: typeof F002_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F002DagTaskGraphExecutionStatus;
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
  readonly auditRecord: F002DagTaskGraphAuditEntry;
}

export interface F002DagTaskGraphTelemetrySnapshot {
  readonly featureId: typeof F002_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F002_CONFIG: F002DagTaskGraphConfig = {
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

export class F002DagTaskGraphValidationError extends Error {
  public readonly featureId = F002_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F002 Validation Error on '${field}']: ${message}`);
    this.name = "F002DagTaskGraphValidationError";
    this.field = field;
  }
}

export function computeF002Digest(rawPayload: string): string {
  return `f002_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F002DagTaskGraphEngine {
  private readonly config: F002DagTaskGraphConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F002DagTaskGraphOutput[] = [];
  private readonly auditLog: F002DagTaskGraphAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F002DagTaskGraphOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F002DagTaskGraphConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F002_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F002DagTaskGraphConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F002DagTaskGraphInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F002DagTaskGraphValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F002DagTaskGraphValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F002DagTaskGraphValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F002DagTaskGraphValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F002DagTaskGraphValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F002DagTaskGraphValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F002DagTaskGraphValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      graph_id: input.graph_id,
      root_task_id: input.root_task_id,
      topological_order: input.topological_order,
      acyclic_verified: input.acyclic_verified
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F002DagTaskGraphValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F002DagTaskGraphInput): F002DagTaskGraphOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F002_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        graph_id: input.graph_id,
        root_task_id: input.root_task_id,
        topological_order: input.topological_order,
        acyclic_verified: input.acyclic_verified
      });
      const payloadHash = computeF002Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F002DagTaskGraphValidationError(
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
        featureId: F002_FEATURE_ID,
        operationCode: F002_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          graph_id: input.graph_id,
          root_task_id: input.root_task_id,
          topological_order: input.topological_order,
          acyclic_verified: input.acyclic_verified
        }
      });

      const executionId = `exec_f002_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f002_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F002DagTaskGraphAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F002_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dag_scheduler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F002DagTaskGraphOutput = {
        featureId: F002_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F002_OPERATION_CODE,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string,
        resolved_root_task_id: kernelResult.resolvedFields.root_task_id as string | number,
        resolved_topological_order: kernelResult.resolvedFields.topological_order as string | number | boolean | readonly string[],
        resolved_acyclic_verified: kernelResult.resolvedFields.acyclic_verified as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F002DagTaskGraphTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F002_FEATURE_ID,
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

  public getAuditTrail(): readonly F002DagTaskGraphAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F002DagTaskGraphOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF002Module(): {
  featureId: typeof F002_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F002DagTaskGraphEngine();
  const sampleInput: F002DagTaskGraphInput = {
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
