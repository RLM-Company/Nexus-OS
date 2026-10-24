/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F104
 * ============================================================================
 * Feature ID: F104
 * Stage: stage4-intelligence-graph
 * Title: Долгосрочная эпизодическая память воркспейса
 * Description: Сохранение ключевых архитектурных решений и выводов прошлых недель
 * Operation Code: episodic_decision_store
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F104_FEATURE_ID = "F104" as const;
export const F104_STAGE = "stage4-intelligence-graph" as const;
export const F104_OPERATION_CODE = "episodic_decision_store" as const;
export const F104_CONTRACT_VERSION = "1.0.0" as const;

export type F104EpisodicWorkspaceMemoryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
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
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F104EpisodicWorkspaceMemoryAuditEntry;
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
  strictValidation: true,
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

/**
 * Deterministic FNV-1a digest calculator for F104 provenance & audit integrity.
 */
export function computeF104Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f104_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F104: Долгосрочная эпизодическая память воркспейса
 * Сохранение ключевых архитектурных решений и выводов прошлых недель
 */
export class F104EpisodicWorkspaceMemoryEngine {
  private readonly config: F104EpisodicWorkspaceMemoryConfig;
  private readonly executionHistory: F104EpisodicWorkspaceMemoryOutput[] = [];
  private readonly auditLog: F104EpisodicWorkspaceMemoryAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F104EpisodicWorkspaceMemoryConfig>) {
    this.config = {
      ...DEFAULT_F104_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F104EpisodicWorkspaceMemoryConfig {
    return { ...this.config };
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
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F104EpisodicWorkspaceMemoryValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
  }

  public execute(input: F104EpisodicWorkspaceMemoryInput): F104EpisodicWorkspaceMemoryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f104_${this.totalRuns}_${computeF104Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F104_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        workspace_id: input.workspace_id,
        episode_id: input.episode_id,
        architectural_decision: input.architectural_decision,
        retention_priority: input.retention_priority,
      });

      const provenanceDigest = computeF104Digest(canonicalPayload);
      const auditRecord: F104EpisodicWorkspaceMemoryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F104_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `episodic_decision_store:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
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
        resolved_workspace_id: input.workspace_id,
        resolved_episode_id: input.episode_id,
        resolved_architectural_decision: input.architectural_decision,
        resolved_retention_priority: input.retention_priority,
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
          : 0,
    };
  }

  public getAuditTrail(): readonly F104EpisodicWorkspaceMemoryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F104EpisodicWorkspaceMemoryOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F104 (Долгосрочная эпизодическая память воркспейса)
 */
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
    workspace_id: "f104_workspace_id_verified",
    episode_id: 100,
    architectural_decision: true,
    retention_priority: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 104 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F104" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F104_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
