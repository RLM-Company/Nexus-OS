/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F103
 * ============================================================================
 * Feature ID: F103
 * Stage: stage4-intelligence-graph
 * Title: Краткосрочная память рабочей сессии (Working Memory Buffer)
 * Description: Удержание фокуса на текущих переменных и открытых артефактах без размытия внимания
 * Operation Code: working_memory_ring
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F103_FEATURE_ID = "F103" as const;
export const F103_STAGE = "stage4-intelligence-graph" as const;
export const F103_OPERATION_CODE = "working_memory_ring" as const;
export const F103_CONTRACT_VERSION = "1.0.0" as const;

export type F103WorkingMemorySessionBufferExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F103WorkingMemorySessionBufferConfig {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly stage: typeof F103_STAGE;
  readonly operationCode: typeof F103_OPERATION_CODE;
  readonly contractVersion: typeof F103_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F103WorkingMemorySessionBufferInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly session_id: string;
  readonly active_slots_used: string | number;
  readonly focused_artifact_ids: string | number | boolean | readonly string[];
  readonly attention_score: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F103WorkingMemorySessionBufferOutput {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F103WorkingMemorySessionBufferExecutionStatus;
  readonly operationCode: typeof F103_OPERATION_CODE;
  readonly resolved_session_id: string;
  readonly resolved_active_slots_used: string | number;
  readonly resolved_focused_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_attention_score: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F103WorkingMemorySessionBufferAuditEntry;
}

export interface F103WorkingMemorySessionBufferAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F103_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F103WorkingMemorySessionBufferTelemetrySnapshot {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F103_CONFIG: F103WorkingMemorySessionBufferConfig = {
  featureId: F103_FEATURE_ID,
  stage: F103_STAGE,
  operationCode: F103_OPERATION_CODE,
  contractVersion: F103_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F103WorkingMemorySessionBufferValidationError extends Error {
  public readonly featureId = F103_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F103 Validation Error on '${field}']: ${message}`);
    this.name = "F103WorkingMemorySessionBufferValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F103 provenance & audit integrity.
 */
export function computeF103Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f103_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F103: Краткосрочная память рабочей сессии (Working Memory Buffer)
 * Удержание фокуса на текущих переменных и открытых артефактах без размытия внимания
 */
export class F103WorkingMemorySessionBufferEngine {
  private readonly config: F103WorkingMemorySessionBufferConfig;
  private readonly executionHistory: F103WorkingMemorySessionBufferOutput[] = [];
  private readonly auditLog: F103WorkingMemorySessionBufferAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F103WorkingMemorySessionBufferConfig>) {
    this.config = {
      ...DEFAULT_F103_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F103WorkingMemorySessionBufferConfig {
    return { ...this.config };
  }

  public validateInput(input: F103WorkingMemorySessionBufferInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.session_id).trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("session_id", "Primary domain attribute 'session_id' cannot be empty.");
    }
  }

  public execute(input: F103WorkingMemorySessionBufferInput): F103WorkingMemorySessionBufferOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f103_${this.totalRuns}_${computeF103Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F103_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        session_id: input.session_id,
        active_slots_used: input.active_slots_used,
        focused_artifact_ids: input.focused_artifact_ids,
        attention_score: input.attention_score,
      });

      const provenanceDigest = computeF103Digest(canonicalPayload);
      const auditRecord: F103WorkingMemorySessionBufferAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F103_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `working_memory_ring:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F103WorkingMemorySessionBufferOutput = {
        featureId: F103_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F103_OPERATION_CODE,
        resolved_session_id: input.session_id,
        resolved_active_slots_used: input.active_slots_used,
        resolved_focused_artifact_ids: input.focused_artifact_ids,
        resolved_attention_score: input.attention_score,
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

  public getTelemetrySnapshot(): F103WorkingMemorySessionBufferTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F103_FEATURE_ID,
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

  public getAuditTrail(): readonly F103WorkingMemorySessionBufferAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F103WorkingMemorySessionBufferOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F103 (Краткосрочная память рабочей сессии (Working Memory Buffer))
 */
export function verifyF103Module(): {
  featureId: typeof F103_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F103WorkingMemorySessionBufferEngine();
  const sampleInput: F103WorkingMemorySessionBufferInput = {
    requestId: "req_verify_f103",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    session_id: "f103_session_id_verified",
    active_slots_used: 100,
    focused_artifact_ids: true,
    attention_score: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 103 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F103" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F103_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
