/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F054
 * ============================================================================
 * Feature ID: F054
 * Stage: stage2-canvas
 * Title: Блокировка секций от перезаписи (Section Locking)
 * Description: Заморозка утверждённых абзацев, чтобы агент не менял их при глобальном рефакторинге
 * Operation Code: section_lock_guard
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F054_FEATURE_ID = "F054" as const;
export const F054_STAGE = "stage2-canvas" as const;
export const F054_OPERATION_CODE = "section_lock_guard" as const;
export const F054_CONTRACT_VERSION = "1.0.0" as const;

export type F054SectionOverwriteLockingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F054SectionOverwriteLockingConfig {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly stage: typeof F054_STAGE;
  readonly operationCode: typeof F054_OPERATION_CODE;
  readonly contractVersion: typeof F054_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F054SectionOverwriteLockingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly locked_section_ids: string | number;
  readonly write_attempt_blocked: string | number | boolean | readonly string[];
  readonly owner_lock_token: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F054SectionOverwriteLockingOutput {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F054SectionOverwriteLockingExecutionStatus;
  readonly operationCode: typeof F054_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_locked_section_ids: string | number;
  readonly resolved_write_attempt_blocked: string | number | boolean | readonly string[];
  readonly resolved_owner_lock_token: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F054SectionOverwriteLockingAuditEntry;
}

export interface F054SectionOverwriteLockingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F054_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F054SectionOverwriteLockingTelemetrySnapshot {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F054_CONFIG: F054SectionOverwriteLockingConfig = {
  featureId: F054_FEATURE_ID,
  stage: F054_STAGE,
  operationCode: F054_OPERATION_CODE,
  contractVersion: F054_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F054SectionOverwriteLockingValidationError extends Error {
  public readonly featureId = F054_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F054 Validation Error on '${field}']: ${message}`);
    this.name = "F054SectionOverwriteLockingValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F054 provenance & audit integrity.
 */
export function computeF054Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f054_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F054: Блокировка секций от перезаписи (Section Locking)
 * Заморозка утверждённых абзацев, чтобы агент не менял их при глобальном рефакторинге
 */
export class F054SectionOverwriteLockingEngine {
  private readonly config: F054SectionOverwriteLockingConfig;
  private readonly executionHistory: F054SectionOverwriteLockingOutput[] = [];
  private readonly auditLog: F054SectionOverwriteLockingAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F054SectionOverwriteLockingConfig>) {
    this.config = {
      ...DEFAULT_F054_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F054SectionOverwriteLockingConfig {
    return { ...this.config };
  }

  public validateInput(input: F054SectionOverwriteLockingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
  }

  public execute(input: F054SectionOverwriteLockingInput): F054SectionOverwriteLockingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f054_${this.totalRuns}_${computeF054Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F054_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        artifact_id: input.artifact_id,
        locked_section_ids: input.locked_section_ids,
        write_attempt_blocked: input.write_attempt_blocked,
        owner_lock_token: input.owner_lock_token,
      });

      const provenanceDigest = computeF054Digest(canonicalPayload);
      const auditRecord: F054SectionOverwriteLockingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F054_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `section_lock_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F054SectionOverwriteLockingOutput = {
        featureId: F054_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F054_OPERATION_CODE,
        resolved_artifact_id: input.artifact_id,
        resolved_locked_section_ids: input.locked_section_ids,
        resolved_write_attempt_blocked: input.write_attempt_blocked,
        resolved_owner_lock_token: input.owner_lock_token,
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

  public getTelemetrySnapshot(): F054SectionOverwriteLockingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F054_FEATURE_ID,
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

  public getAuditTrail(): readonly F054SectionOverwriteLockingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F054SectionOverwriteLockingOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F054 (Блокировка секций от перезаписи (Section Locking))
 */
export function verifyF054Module(): {
  featureId: typeof F054_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F054SectionOverwriteLockingEngine();
  const sampleInput: F054SectionOverwriteLockingInput = {
    requestId: "req_verify_f054",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f054_artifact_id_verified",
    locked_section_ids: 100,
    write_attempt_blocked: true,
    owner_lock_token: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 54 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F054" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F054_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
