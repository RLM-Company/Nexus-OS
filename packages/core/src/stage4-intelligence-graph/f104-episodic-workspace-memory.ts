/**
 * F104 (stage4-intelligence-graph): Долгосрочная эпизодическая память воркспейса
 * Сохранение ключевых архитектурных решений и выводов прошлых недель
 * Operation Code: episodic_decision_store
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F104_FEATURE_ID = "F104" as const;
export const F104_STAGE = "stage4-intelligence-graph" as const;
export const F104_OPERATION_CODE = "episodic_decision_store" as const;
export const F104_CONTRACT_VERSION = "2.0.0" as const;

export type F104EpisodicWorkspaceMemoryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F104EpisodicWorkspaceMemoryConfig {
  readonly featureId: typeof F104_FEATURE_ID;
  readonly stage: typeof F104_STAGE;
  readonly operationCode: typeof F104_OPERATION_CODE;
  readonly contractVersion: typeof F104_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F104EpisodicWorkspaceMemoryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly episode_id: string | number;
  readonly architectural_decision: string | number | boolean | readonly string[];
  readonly retention_priority: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F104EpisodicWorkspaceMemoryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F104_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F104EpisodicWorkspaceMemoryOutput {
  readonly featureId: typeof F104_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F104EpisodicWorkspaceMemoryExecutionStatus;
  readonly operationCode: typeof F104_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_episode_id: string | number;
  readonly resolved_architectural_decision: string | number | boolean | readonly string[];
  readonly resolved_retention_priority: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F104EpisodicWorkspaceMemoryAuditEntry;
}

export interface F104EpisodicWorkspaceMemoryTelemetrySnapshot {
  readonly featureId: typeof F104_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F104_CONFIG: F104EpisodicWorkspaceMemoryConfig = {
  featureId: F104_FEATURE_ID,
  stage: F104_STAGE,
  operationCode: F104_OPERATION_CODE,
  contractVersion: F104_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F104EpisodicWorkspaceMemoryValidationError extends Error {
  public readonly featureId = F104_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F104 Validation Error on '${field}']: ${message}`);
    this.name = "F104EpisodicWorkspaceMemoryValidationError";
    this.field = field;
  }
}

export function computeF104Digest(rawPayload: string): string {
  return `f104_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F104EpisodicWorkspaceMemoryEngine {
  private readonly config: F104EpisodicWorkspaceMemoryConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F104EpisodicWorkspaceMemoryOutput[] = [];
  private readonly auditLog: F104EpisodicWorkspaceMemoryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F104EpisodicWorkspaceMemoryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F104EpisodicWorkspaceMemoryConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F104_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F104EpisodicWorkspaceMemoryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F104EpisodicWorkspaceMemoryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F104EpisodicWorkspaceMemoryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      episode_id: input.episode_id,
      architectural_decision: input.architectural_decision,
      retention_priority: input.retention_priority
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F104EpisodicWorkspaceMemoryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F104EpisodicWorkspaceMemoryInput): F104EpisodicWorkspaceMemoryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F104_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        episode_id: input.episode_id,
        architectural_decision: input.architectural_decision,
        retention_priority: input.retention_priority
      });
      const payloadHash = computeF104Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F104EpisodicWorkspaceMemoryValidationError(
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
        featureId: F104_FEATURE_ID,
        operationCode: F104_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          episode_id: input.episode_id,
          architectural_decision: input.architectural_decision,
          retention_priority: input.retention_priority
        }
      });

      const executionId = `exec_f104_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f104_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F104EpisodicWorkspaceMemoryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F104_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `episodic_decision_store:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F104EpisodicWorkspaceMemoryOutput = {
        featureId: F104_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F104_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_episode_id: kernelResult.resolvedFields.episode_id as string | number,
        resolved_architectural_decision: kernelResult.resolvedFields.architectural_decision as string | number | boolean | readonly string[],
        resolved_retention_priority: kernelResult.resolvedFields.retention_priority as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F104EpisodicWorkspaceMemoryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F104_FEATURE_ID,
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

  public getAuditTrail(): readonly F104EpisodicWorkspaceMemoryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F104EpisodicWorkspaceMemoryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF104Module(): {
  featureId: typeof F104_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F104EpisodicWorkspaceMemoryEngine();
  const sampleInput: F104EpisodicWorkspaceMemoryInput = {
    requestId: "req_verify_f104",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f104_workspace_id_seed",
    episode_id: 42,
    architectural_decision: true,
    retention_priority: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 104 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F104" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F104_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
