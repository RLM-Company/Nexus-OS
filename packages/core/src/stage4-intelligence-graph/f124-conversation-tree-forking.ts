/**
 * F124 (stage4-intelligence-graph): Ветвление чатов от любого сообщения (Conversation Forking)
 * Создание параллельной ветки обсуждения без потери исходного дерева диалога
 * Operation Code: chat_branch_forker
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F124_FEATURE_ID = "F124" as const;
export const F124_STAGE = "stage4-intelligence-graph" as const;
export const F124_OPERATION_CODE = "chat_branch_forker" as const;
export const F124_CONTRACT_VERSION = "2.0.0" as const;

export type F124ConversationTreeForkingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F124ConversationTreeForkingConfig {
  readonly featureId: typeof F124_FEATURE_ID;
  readonly stage: typeof F124_STAGE;
  readonly operationCode: typeof F124_OPERATION_CODE;
  readonly contractVersion: typeof F124_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F124ConversationTreeForkingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly parent_thread_id: string;
  readonly fork_message_id: string | number;
  readonly new_branch_id: string | number | boolean | readonly string[];
  readonly inherited_context_hash: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F124ConversationTreeForkingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F124_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F124ConversationTreeForkingOutput {
  readonly featureId: typeof F124_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F124ConversationTreeForkingExecutionStatus;
  readonly operationCode: typeof F124_OPERATION_CODE;
  readonly resolved_parent_thread_id: string;
  readonly resolved_fork_message_id: string | number;
  readonly resolved_new_branch_id: string | number | boolean | readonly string[];
  readonly resolved_inherited_context_hash: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F124ConversationTreeForkingAuditEntry;
}

export interface F124ConversationTreeForkingTelemetrySnapshot {
  readonly featureId: typeof F124_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F124_CONFIG: F124ConversationTreeForkingConfig = {
  featureId: F124_FEATURE_ID,
  stage: F124_STAGE,
  operationCode: F124_OPERATION_CODE,
  contractVersion: F124_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F124ConversationTreeForkingValidationError extends Error {
  public readonly featureId = F124_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F124 Validation Error on '${field}']: ${message}`);
    this.name = "F124ConversationTreeForkingValidationError";
    this.field = field;
  }
}

export function computeF124Digest(rawPayload: string): string {
  return `f124_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F124ConversationTreeForkingEngine {
  private readonly config: F124ConversationTreeForkingConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F124ConversationTreeForkingOutput[] = [];
  private readonly auditLog: F124ConversationTreeForkingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F124ConversationTreeForkingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F124ConversationTreeForkingConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F124_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F124ConversationTreeForkingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F124ConversationTreeForkingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F124ConversationTreeForkingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.parent_thread_id).trim().length === 0) {
      throw new F124ConversationTreeForkingValidationError("parent_thread_id", "Primary domain attribute 'parent_thread_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      parent_thread_id: input.parent_thread_id,
      fork_message_id: input.fork_message_id,
      new_branch_id: input.new_branch_id,
      inherited_context_hash: input.inherited_context_hash
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F124ConversationTreeForkingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F124ConversationTreeForkingInput): F124ConversationTreeForkingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F124_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        parent_thread_id: input.parent_thread_id,
        fork_message_id: input.fork_message_id,
        new_branch_id: input.new_branch_id,
        inherited_context_hash: input.inherited_context_hash
      });
      const payloadHash = computeF124Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F124ConversationTreeForkingValidationError(
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
        featureId: F124_FEATURE_ID,
        operationCode: F124_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          parent_thread_id: input.parent_thread_id,
          fork_message_id: input.fork_message_id,
          new_branch_id: input.new_branch_id,
          inherited_context_hash: input.inherited_context_hash
        }
      });

      const executionId = `exec_f124_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f124_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F124ConversationTreeForkingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F124_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chat_branch_forker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F124ConversationTreeForkingOutput = {
        featureId: F124_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F124_OPERATION_CODE,
        resolved_parent_thread_id: kernelResult.resolvedFields.parent_thread_id as string,
        resolved_fork_message_id: kernelResult.resolvedFields.fork_message_id as string | number,
        resolved_new_branch_id: kernelResult.resolvedFields.new_branch_id as string | number | boolean | readonly string[],
        resolved_inherited_context_hash: kernelResult.resolvedFields.inherited_context_hash as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F124ConversationTreeForkingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F124_FEATURE_ID,
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

  public getAuditTrail(): readonly F124ConversationTreeForkingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F124ConversationTreeForkingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF124Module(): {
  featureId: typeof F124_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F124ConversationTreeForkingEngine();
  const sampleInput: F124ConversationTreeForkingInput = {
    requestId: "req_verify_f124",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    parent_thread_id: "f124_parent_thread_id_seed",
    fork_message_id: 42,
    new_branch_id: true,
    inherited_context_hash: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 124 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F124" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parent_thread_id !== sampleInput.parent_thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F124_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
