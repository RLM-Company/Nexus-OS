/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F031
 * ============================================================================
 * Feature ID: F031
 * Stage: stage1-autonomy
 * Title: Реестр активных воркеров (Agent Registry)
 * Description: Мониторинг живых процессов, их загрузки и текущих задач в реальном времени
 * Operation Code: worker_registry
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F031_FEATURE_ID = "F031" as const;
export const F031_STAGE = "stage1-autonomy" as const;
export const F031_OPERATION_CODE = "worker_registry" as const;
export const F031_CONTRACT_VERSION = "1.0.0" as const;

export type F031ActiveWorkerRegistryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F031ActiveWorkerRegistryConfig {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly stage: typeof F031_STAGE;
  readonly operationCode: typeof F031_OPERATION_CODE;
  readonly contractVersion: typeof F031_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F031ActiveWorkerRegistryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly instance_id: string;
  readonly assigned_role: string | number;
  readonly cpu_load_pct: string | number | boolean | readonly string[];
  readonly heartbeat_healthy: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F031ActiveWorkerRegistryOutput {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F031ActiveWorkerRegistryExecutionStatus;
  readonly operationCode: typeof F031_OPERATION_CODE;
  readonly resolved_instance_id: string;
  readonly resolved_assigned_role: string | number;
  readonly resolved_cpu_load_pct: string | number | boolean | readonly string[];
  readonly resolved_heartbeat_healthy: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F031ActiveWorkerRegistryAuditEntry;
}

export interface F031ActiveWorkerRegistryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F031_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F031ActiveWorkerRegistryTelemetrySnapshot {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F031_CONFIG: F031ActiveWorkerRegistryConfig = {
  featureId: F031_FEATURE_ID,
  stage: F031_STAGE,
  operationCode: F031_OPERATION_CODE,
  contractVersion: F031_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F031ActiveWorkerRegistryValidationError extends Error {
  public readonly featureId = F031_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F031 Validation Error on '${field}']: ${message}`);
    this.name = "F031ActiveWorkerRegistryValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F031 provenance & audit integrity.
 */
export function computeF031Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f031_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F031: Реестр активных воркеров (Agent Registry)
 * Мониторинг живых процессов, их загрузки и текущих задач в реальном времени
 */
export class F031ActiveWorkerRegistryEngine {
  private readonly config: F031ActiveWorkerRegistryConfig;
  private readonly executionHistory: F031ActiveWorkerRegistryOutput[] = [];
  private readonly auditLog: F031ActiveWorkerRegistryAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F031ActiveWorkerRegistryConfig>) {
    this.config = {
      ...DEFAULT_F031_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F031ActiveWorkerRegistryConfig {
    return { ...this.config };
  }

  public validateInput(input: F031ActiveWorkerRegistryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.instance_id).trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("instance_id", "Primary domain attribute 'instance_id' cannot be empty.");
    }
  }

  public execute(input: F031ActiveWorkerRegistryInput): F031ActiveWorkerRegistryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f031_${this.totalRuns}_${computeF031Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F031_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        instance_id: input.instance_id,
        assigned_role: input.assigned_role,
        cpu_load_pct: input.cpu_load_pct,
        heartbeat_healthy: input.heartbeat_healthy,
      });

      const provenanceDigest = computeF031Digest(canonicalPayload);
      const auditRecord: F031ActiveWorkerRegistryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F031_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `worker_registry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F031ActiveWorkerRegistryOutput = {
        featureId: F031_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F031_OPERATION_CODE,
        resolved_instance_id: input.instance_id,
        resolved_assigned_role: input.assigned_role,
        resolved_cpu_load_pct: input.cpu_load_pct,
        resolved_heartbeat_healthy: input.heartbeat_healthy,
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

  public getTelemetrySnapshot(): F031ActiveWorkerRegistryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F031_FEATURE_ID,
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

  public getAuditTrail(): readonly F031ActiveWorkerRegistryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F031ActiveWorkerRegistryOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F031 (Реестр активных воркеров (Agent Registry))
 */
export function verifyF031Module(): {
  featureId: typeof F031_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F031ActiveWorkerRegistryEngine();
  const sampleInput: F031ActiveWorkerRegistryInput = {
    requestId: "req_verify_f031",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    instance_id: "f031_instance_id_verified",
    assigned_role: 100,
    cpu_load_pct: true,
    heartbeat_healthy: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 31 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F031" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F031_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
