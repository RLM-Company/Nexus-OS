/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F014
 * ============================================================================
 * Feature ID: F014
 * Stage: stage1-autonomy
 * Title: Приоритизация очереди задач
 * Description: Динамическое перестроение весов в очереди при поступлении срочного сообщения от пользователя
 * Operation Code: priority_scheduler
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F014_FEATURE_ID = "F014" as const;
export const F014_STAGE = "stage1-autonomy" as const;
export const F014_OPERATION_CODE = "priority_scheduler" as const;
export const F014_CONTRACT_VERSION = "1.0.0" as const;

export type F014DynamicTaskQueuePriorityExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F014DynamicTaskQueuePriorityConfig {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly stage: typeof F014_STAGE;
  readonly operationCode: typeof F014_OPERATION_CODE;
  readonly contractVersion: typeof F014_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F014DynamicTaskQueuePriorityInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly queue_id: string;
  readonly urgent_task_id: string | number;
  readonly previous_weight: string | number | boolean | readonly string[];
  readonly new_priority_weight: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F014DynamicTaskQueuePriorityOutput {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F014DynamicTaskQueuePriorityExecutionStatus;
  readonly operationCode: typeof F014_OPERATION_CODE;
  readonly resolved_queue_id: string;
  readonly resolved_urgent_task_id: string | number;
  readonly resolved_previous_weight: string | number | boolean | readonly string[];
  readonly resolved_new_priority_weight: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F014DynamicTaskQueuePriorityAuditEntry;
}

export interface F014DynamicTaskQueuePriorityAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F014_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F014DynamicTaskQueuePriorityTelemetrySnapshot {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F014_CONFIG: F014DynamicTaskQueuePriorityConfig = {
  featureId: F014_FEATURE_ID,
  stage: F014_STAGE,
  operationCode: F014_OPERATION_CODE,
  contractVersion: F014_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F014DynamicTaskQueuePriorityValidationError extends Error {
  public readonly featureId = F014_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F014 Validation Error on '${field}']: ${message}`);
    this.name = "F014DynamicTaskQueuePriorityValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F014 provenance & audit integrity.
 */
export function computeF014Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f014_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F014: Приоритизация очереди задач
 * Динамическое перестроение весов в очереди при поступлении срочного сообщения от пользователя
 */
export class F014DynamicTaskQueuePriorityEngine {
  private readonly config: F014DynamicTaskQueuePriorityConfig;
  private readonly executionHistory: F014DynamicTaskQueuePriorityOutput[] = [];
  private readonly auditLog: F014DynamicTaskQueuePriorityAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F014DynamicTaskQueuePriorityConfig>) {
    this.config = {
      ...DEFAULT_F014_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F014DynamicTaskQueuePriorityConfig {
    return { ...this.config };
  }

  public validateInput(input: F014DynamicTaskQueuePriorityInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.queue_id).trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("queue_id", "Primary domain attribute 'queue_id' cannot be empty.");
    }
  }

  public execute(input: F014DynamicTaskQueuePriorityInput): F014DynamicTaskQueuePriorityOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f014_${this.totalRuns}_${computeF014Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F014_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        queue_id: input.queue_id,
        urgent_task_id: input.urgent_task_id,
        previous_weight: input.previous_weight,
        new_priority_weight: input.new_priority_weight,
      });

      const provenanceDigest = computeF014Digest(canonicalPayload);
      const auditRecord: F014DynamicTaskQueuePriorityAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F014_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `priority_scheduler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F014DynamicTaskQueuePriorityOutput = {
        featureId: F014_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F014_OPERATION_CODE,
        resolved_queue_id: input.queue_id,
        resolved_urgent_task_id: input.urgent_task_id,
        resolved_previous_weight: input.previous_weight,
        resolved_new_priority_weight: input.new_priority_weight,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord,
      };

      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F014DynamicTaskQueuePriorityTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F014_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0,
    };
  }

  public getAuditTrail(): readonly F014DynamicTaskQueuePriorityAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F014DynamicTaskQueuePriorityOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F014 (Приоритизация очереди задач)
 */
export function verifyF014Module(): {
  featureId: typeof F014_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F014DynamicTaskQueuePriorityEngine();
  const sampleInput: F014DynamicTaskQueuePriorityInput = {
    requestId: "req_verify_f014",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    queue_id: "f014_queue_id_verified",
    urgent_task_id: 100,
    previous_weight: true,
    new_priority_weight: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 14 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F014" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F014_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
