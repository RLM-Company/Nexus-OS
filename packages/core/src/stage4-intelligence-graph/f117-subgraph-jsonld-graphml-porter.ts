/**
 * F117 (stage4-intelligence-graph): Импорт и экспорт подграфов знаний (JSON-LD / GraphML)
 * Перенос накопленной базы знаний проекта между инстансами
 * Operation Code: subgraph_serializer
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F117_FEATURE_ID = "F117" as const;
export const F117_STAGE = "stage4-intelligence-graph" as const;
export const F117_OPERATION_CODE = "subgraph_serializer" as const;
export const F117_CONTRACT_VERSION = "2.0.0" as const;

export type F117SubgraphJsonldGraphmlPorterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F117SubgraphJsonldGraphmlPorterConfig {
  readonly featureId: typeof F117_FEATURE_ID;
  readonly stage: typeof F117_STAGE;
  readonly operationCode: typeof F117_OPERATION_CODE;
  readonly contractVersion: typeof F117_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F117SubgraphJsonldGraphmlPorterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly export_format: string | number;
  readonly serialized_nodes: string | number | boolean | readonly string[];
  readonly portable_payload: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F117SubgraphJsonldGraphmlPorterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F117_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

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

export interface F117SubgraphJsonldGraphmlPorterTelemetrySnapshot {
  readonly featureId: typeof F117_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

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

export class F117SubgraphJsonldGraphmlPorterEngine {
  private readonly config: F117SubgraphJsonldGraphmlPorterConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F117SubgraphJsonldGraphmlPorterOutput[] = [];
  private readonly auditLog: F117SubgraphJsonldGraphmlPorterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F117SubgraphJsonldGraphmlPorterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F117SubgraphJsonldGraphmlPorterConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F117_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F117SubgraphJsonldGraphmlPorterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F117SubgraphJsonldGraphmlPorterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F117SubgraphJsonldGraphmlPorterValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      export_format: input.export_format,
      serialized_nodes: input.serialized_nodes,
      portable_payload: input.portable_payload
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F117SubgraphJsonldGraphmlPorterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F117SubgraphJsonldGraphmlPorterInput): F117SubgraphJsonldGraphmlPorterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F117_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        export_format: input.export_format,
        serialized_nodes: input.serialized_nodes,
        portable_payload: input.portable_payload
      });
      const payloadHash = computeF117Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F117SubgraphJsonldGraphmlPorterValidationError(
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
        featureId: F117_FEATURE_ID,
        operationCode: F117_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          export_format: input.export_format,
          serialized_nodes: input.serialized_nodes,
          portable_payload: input.portable_payload
        }
      });

      const executionId = `exec_f117_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f117_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F117SubgraphJsonldGraphmlPorterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F117_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `subgraph_serializer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F117SubgraphJsonldGraphmlPorterOutput = {
        featureId: F117_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F117_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_export_format: kernelResult.resolvedFields.export_format as string | number,
        resolved_serialized_nodes: kernelResult.resolvedFields.serialized_nodes as string | number | boolean | readonly string[],
        resolved_portable_payload: kernelResult.resolvedFields.portable_payload as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F117SubgraphJsonldGraphmlPorterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F117_FEATURE_ID,
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

  public getAuditTrail(): readonly F117SubgraphJsonldGraphmlPorterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F117SubgraphJsonldGraphmlPorterOutput[] {
    return [...this.executionHistory];
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
