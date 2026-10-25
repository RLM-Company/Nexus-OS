/**
 * F114 (stage4-intelligence-graph): Глобальный мост знаний (Cross-Workspace Shared Library)
 * Опциональное подключение общих корпоративных справочников и стандартов ко всем проектам
 * Operation Code: shared_library_bridge
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F114_FEATURE_ID = "F114" as const;
export const F114_STAGE = "stage4-intelligence-graph" as const;
export const F114_OPERATION_CODE = "shared_library_bridge" as const;
export const F114_CONTRACT_VERSION = "2.0.0" as const;

export type F114GlobalSharedKnowledgeBridgeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F114GlobalSharedKnowledgeBridgeConfig {
  readonly featureId: typeof F114_FEATURE_ID;
  readonly stage: typeof F114_STAGE;
  readonly operationCode: typeof F114_OPERATION_CODE;
  readonly contractVersion: typeof F114_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F114GlobalSharedKnowledgeBridgeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly library_id: string;
  readonly subscribed_workspaces: string | number;
  readonly shared_nodes_count: string | number | boolean | readonly string[];
  readonly read_only_mount: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F114GlobalSharedKnowledgeBridgeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F114_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F114GlobalSharedKnowledgeBridgeOutput {
  readonly featureId: typeof F114_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F114GlobalSharedKnowledgeBridgeExecutionStatus;
  readonly operationCode: typeof F114_OPERATION_CODE;
  readonly resolved_library_id: string;
  readonly resolved_subscribed_workspaces: string | number;
  readonly resolved_shared_nodes_count: string | number | boolean | readonly string[];
  readonly resolved_read_only_mount: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F114GlobalSharedKnowledgeBridgeAuditEntry;
}

export interface F114GlobalSharedKnowledgeBridgeTelemetrySnapshot {
  readonly featureId: typeof F114_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F114_CONFIG: F114GlobalSharedKnowledgeBridgeConfig = {
  featureId: F114_FEATURE_ID,
  stage: F114_STAGE,
  operationCode: F114_OPERATION_CODE,
  contractVersion: F114_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F114GlobalSharedKnowledgeBridgeValidationError extends Error {
  public readonly featureId = F114_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F114 Validation Error on '${field}']: ${message}`);
    this.name = "F114GlobalSharedKnowledgeBridgeValidationError";
    this.field = field;
  }
}

export function computeF114Digest(rawPayload: string): string {
  return `f114_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F114GlobalSharedKnowledgeBridgeEngine {
  private readonly config: F114GlobalSharedKnowledgeBridgeConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F114GlobalSharedKnowledgeBridgeOutput[] = [];
  private readonly auditLog: F114GlobalSharedKnowledgeBridgeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F114GlobalSharedKnowledgeBridgeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F114GlobalSharedKnowledgeBridgeConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F114_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F114GlobalSharedKnowledgeBridgeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F114GlobalSharedKnowledgeBridgeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.library_id).trim().length === 0) {
      throw new F114GlobalSharedKnowledgeBridgeValidationError("library_id", "Primary domain attribute 'library_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      library_id: input.library_id,
      subscribed_workspaces: input.subscribed_workspaces,
      shared_nodes_count: input.shared_nodes_count,
      read_only_mount: input.read_only_mount
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F114GlobalSharedKnowledgeBridgeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F114GlobalSharedKnowledgeBridgeInput): F114GlobalSharedKnowledgeBridgeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F114_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        library_id: input.library_id,
        subscribed_workspaces: input.subscribed_workspaces,
        shared_nodes_count: input.shared_nodes_count,
        read_only_mount: input.read_only_mount
      });
      const payloadHash = computeF114Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F114GlobalSharedKnowledgeBridgeValidationError(
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
        featureId: F114_FEATURE_ID,
        operationCode: F114_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          library_id: input.library_id,
          subscribed_workspaces: input.subscribed_workspaces,
          shared_nodes_count: input.shared_nodes_count,
          read_only_mount: input.read_only_mount
        }
      });

      const executionId = `exec_f114_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f114_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F114GlobalSharedKnowledgeBridgeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F114_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `shared_library_bridge:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F114GlobalSharedKnowledgeBridgeOutput = {
        featureId: F114_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F114_OPERATION_CODE,
        resolved_library_id: kernelResult.resolvedFields.library_id as string,
        resolved_subscribed_workspaces: kernelResult.resolvedFields.subscribed_workspaces as string | number,
        resolved_shared_nodes_count: kernelResult.resolvedFields.shared_nodes_count as string | number | boolean | readonly string[],
        resolved_read_only_mount: kernelResult.resolvedFields.read_only_mount as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F114GlobalSharedKnowledgeBridgeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F114_FEATURE_ID,
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

  public getAuditTrail(): readonly F114GlobalSharedKnowledgeBridgeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F114GlobalSharedKnowledgeBridgeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF114Module(): {
  featureId: typeof F114_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F114GlobalSharedKnowledgeBridgeEngine();
  const sampleInput: F114GlobalSharedKnowledgeBridgeInput = {
    requestId: "req_verify_f114",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    library_id: "f114_library_id_seed",
    subscribed_workspaces: 42,
    shared_nodes_count: true,
    read_only_mount: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 114 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F114" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_library_id !== sampleInput.library_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F114_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
