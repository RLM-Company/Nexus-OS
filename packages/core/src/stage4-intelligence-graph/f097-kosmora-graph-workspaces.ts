/**
 * F097 (stage4-intelligence-graph): Графовые воркспейсы Kosmora (Kosmora Graph Workspaces)
 * Визуальное пространство проекта, где чаты, файлы, задачи и артефакты представлены как связанные узлы
 * Operation Code: graph_workspace_topology
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F097_FEATURE_ID = "F097" as const;
export const F097_STAGE = "stage4-intelligence-graph" as const;
export const F097_OPERATION_CODE = "graph_workspace_topology" as const;
export const F097_CONTRACT_VERSION = "2.0.0" as const;

export type F097KosmoraGraphWorkspacesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F097KosmoraGraphWorkspacesConfig {
  readonly featureId: typeof F097_FEATURE_ID;
  readonly stage: typeof F097_STAGE;
  readonly operationCode: typeof F097_OPERATION_CODE;
  readonly contractVersion: typeof F097_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F097KosmoraGraphWorkspacesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly nodes_count: string | number;
  readonly edges_count: string | number | boolean | readonly string[];
  readonly connected_components: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F097KosmoraGraphWorkspacesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F097_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F097KosmoraGraphWorkspacesOutput {
  readonly featureId: typeof F097_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F097KosmoraGraphWorkspacesExecutionStatus;
  readonly operationCode: typeof F097_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_nodes_count: string | number;
  readonly resolved_edges_count: string | number | boolean | readonly string[];
  readonly resolved_connected_components: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F097KosmoraGraphWorkspacesAuditEntry;
}

export interface F097KosmoraGraphWorkspacesTelemetrySnapshot {
  readonly featureId: typeof F097_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F097_CONFIG: F097KosmoraGraphWorkspacesConfig = {
  featureId: F097_FEATURE_ID,
  stage: F097_STAGE,
  operationCode: F097_OPERATION_CODE,
  contractVersion: F097_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F097KosmoraGraphWorkspacesValidationError extends Error {
  public readonly featureId = F097_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F097 Validation Error on '${field}']: ${message}`);
    this.name = "F097KosmoraGraphWorkspacesValidationError";
    this.field = field;
  }
}

export function computeF097Digest(rawPayload: string): string {
  return `f097_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F097KosmoraGraphWorkspacesEngine {
  private readonly config: F097KosmoraGraphWorkspacesConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F097KosmoraGraphWorkspacesOutput[] = [];
  private readonly auditLog: F097KosmoraGraphWorkspacesAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F097KosmoraGraphWorkspacesOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F097KosmoraGraphWorkspacesConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F097_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F097KosmoraGraphWorkspacesConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F097KosmoraGraphWorkspacesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F097KosmoraGraphWorkspacesValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F097KosmoraGraphWorkspacesValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      nodes_count: input.nodes_count,
      edges_count: input.edges_count,
      connected_components: input.connected_components
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F097KosmoraGraphWorkspacesValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F097KosmoraGraphWorkspacesInput): F097KosmoraGraphWorkspacesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F097_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        nodes_count: input.nodes_count,
        edges_count: input.edges_count,
        connected_components: input.connected_components
      });
      const payloadHash = computeF097Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F097KosmoraGraphWorkspacesValidationError(
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
        featureId: F097_FEATURE_ID,
        operationCode: F097_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          nodes_count: input.nodes_count,
          edges_count: input.edges_count,
          connected_components: input.connected_components
        }
      });

      const executionId = `exec_f097_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f097_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F097KosmoraGraphWorkspacesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F097_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `graph_workspace_topology:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F097KosmoraGraphWorkspacesOutput = {
        featureId: F097_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F097_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_nodes_count: kernelResult.resolvedFields.nodes_count as string | number,
        resolved_edges_count: kernelResult.resolvedFields.edges_count as string | number | boolean | readonly string[],
        resolved_connected_components: kernelResult.resolvedFields.connected_components as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F097KosmoraGraphWorkspacesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F097_FEATURE_ID,
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

  public getAuditTrail(): readonly F097KosmoraGraphWorkspacesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F097KosmoraGraphWorkspacesOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF097Module(): {
  featureId: typeof F097_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F097KosmoraGraphWorkspacesEngine();
  const sampleInput: F097KosmoraGraphWorkspacesInput = {
    requestId: "req_verify_f097",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f097_workspace_id_seed",
    nodes_count: 42,
    edges_count: true,
    connected_components: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 97 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F097" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F097_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
