/**
 * F098 (stage4-intelligence-graph): Слои графа знаний (Intelligence Graph Layers)
 * Разделение графа на слои: документов, задач, кодовых модулей и бизнес-сущностей
 * Operation Code: multilayer_graph_partition
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F098_FEATURE_ID = "F098" as const;
export const F098_STAGE = "stage4-intelligence-graph" as const;
export const F098_OPERATION_CODE = "multilayer_graph_partition" as const;
export const F098_CONTRACT_VERSION = "2.0.0" as const;

export type F098IntelligenceGraphLayersExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F098IntelligenceGraphLayersConfig {
  readonly featureId: typeof F098_FEATURE_ID;
  readonly stage: typeof F098_STAGE;
  readonly operationCode: typeof F098_OPERATION_CODE;
  readonly contractVersion: typeof F098_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F098IntelligenceGraphLayersInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly document_nodes: string | number;
  readonly task_nodes: string | number | boolean | readonly string[];
  readonly code_and_entity_nodes: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F098IntelligenceGraphLayersAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F098_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

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

export interface F098IntelligenceGraphLayersTelemetrySnapshot {
  readonly featureId: typeof F098_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

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

export class F098IntelligenceGraphLayersEngine {
  private readonly config: F098IntelligenceGraphLayersConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F098IntelligenceGraphLayersOutput[] = [];
  private readonly auditLog: F098IntelligenceGraphLayersAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F098IntelligenceGraphLayersOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F098IntelligenceGraphLayersConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F098_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F098IntelligenceGraphLayersConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F098IntelligenceGraphLayersInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F098IntelligenceGraphLayersValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F098IntelligenceGraphLayersValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      document_nodes: input.document_nodes,
      task_nodes: input.task_nodes,
      code_and_entity_nodes: input.code_and_entity_nodes
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F098IntelligenceGraphLayersValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F098IntelligenceGraphLayersInput): F098IntelligenceGraphLayersOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F098_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        document_nodes: input.document_nodes,
        task_nodes: input.task_nodes,
        code_and_entity_nodes: input.code_and_entity_nodes
      });
      const payloadHash = computeF098Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F098IntelligenceGraphLayersValidationError(
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
        featureId: F098_FEATURE_ID,
        operationCode: F098_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          document_nodes: input.document_nodes,
          task_nodes: input.task_nodes,
          code_and_entity_nodes: input.code_and_entity_nodes
        }
      });

      const executionId = `exec_f098_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f098_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F098IntelligenceGraphLayersAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F098_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `multilayer_graph_partition:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F098IntelligenceGraphLayersOutput = {
        featureId: F098_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F098_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_document_nodes: kernelResult.resolvedFields.document_nodes as string | number,
        resolved_task_nodes: kernelResult.resolvedFields.task_nodes as string | number | boolean | readonly string[],
        resolved_code_and_entity_nodes: kernelResult.resolvedFields.code_and_entity_nodes as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F098IntelligenceGraphLayersTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F098_FEATURE_ID,
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

  public getAuditTrail(): readonly F098IntelligenceGraphLayersAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F098IntelligenceGraphLayersOutput[] {
    return [...this.executionHistory];
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
