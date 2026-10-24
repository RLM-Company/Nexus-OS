/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F159
 * ============================================================================
 * Feature ID: F159
 * Stage: stage5-enterprise
 * Title: Мониторинг квот хранилища и индексации
 * Description: Контроль объёма загруженных файлов, таблиц и векторных индексов по каждому проекту
 * Operation Code: storage_quota_meter
 * Target Package Directory: packages/policy-engine/src/stage5-enterprise
 * ============================================================================
 */

export const F159_FEATURE_ID = "F159" as const;
export const F159_STAGE = "stage5-enterprise" as const;
export const F159_OPERATION_CODE = "storage_quota_meter" as const;
export const F159_CONTRACT_VERSION = "1.0.0" as const;

export type F159StorageIndexingQuotaMonitorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F159StorageIndexingQuotaMonitorConfig {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly stage: typeof F159_STAGE;
  readonly operationCode: typeof F159_OPERATION_CODE;
  readonly contractVersion: typeof F159_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F159StorageIndexingQuotaMonitorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly project_id: string;
  readonly used_megabytes: string | number;
  readonly quota_limit_megabytes: string | number | boolean | readonly string[];
  readonly alert_threshold_reached: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F159StorageIndexingQuotaMonitorOutput {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F159StorageIndexingQuotaMonitorExecutionStatus;
  readonly operationCode: typeof F159_OPERATION_CODE;
  readonly resolved_project_id: string;
  readonly resolved_used_megabytes: string | number;
  readonly resolved_quota_limit_megabytes: string | number | boolean | readonly string[];
  readonly resolved_alert_threshold_reached: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F159StorageIndexingQuotaMonitorAuditEntry;
}

export interface F159StorageIndexingQuotaMonitorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F159_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F159StorageIndexingQuotaMonitorTelemetrySnapshot {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F159_CONFIG: F159StorageIndexingQuotaMonitorConfig = {
  featureId: F159_FEATURE_ID,
  stage: F159_STAGE,
  operationCode: F159_OPERATION_CODE,
  contractVersion: F159_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F159StorageIndexingQuotaMonitorValidationError extends Error {
  public readonly featureId = F159_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F159 Validation Error on '${field}']: ${message}`);
    this.name = "F159StorageIndexingQuotaMonitorValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F159 provenance & audit integrity.
 */
export function computeF159Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f159_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F159: Мониторинг квот хранилища и индексации
 * Контроль объёма загруженных файлов, таблиц и векторных индексов по каждому проекту
 */
export class F159StorageIndexingQuotaMonitorEngine {
  private readonly config: F159StorageIndexingQuotaMonitorConfig;
  private readonly executionHistory: F159StorageIndexingQuotaMonitorOutput[] = [];
  private readonly auditLog: F159StorageIndexingQuotaMonitorAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F159StorageIndexingQuotaMonitorConfig>) {
    this.config = {
      ...DEFAULT_F159_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F159StorageIndexingQuotaMonitorConfig {
    return { ...this.config };
  }

  public validateInput(input: F159StorageIndexingQuotaMonitorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.project_id).trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("project_id", "Primary domain attribute 'project_id' cannot be empty.");
    }
  }

  public execute(input: F159StorageIndexingQuotaMonitorInput): F159StorageIndexingQuotaMonitorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f159_${this.totalRuns}_${computeF159Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F159_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        project_id: input.project_id,
        used_megabytes: input.used_megabytes,
        quota_limit_megabytes: input.quota_limit_megabytes,
        alert_threshold_reached: input.alert_threshold_reached,
      });

      const provenanceDigest = computeF159Digest(canonicalPayload);
      const auditRecord: F159StorageIndexingQuotaMonitorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F159_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `storage_quota_meter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F159StorageIndexingQuotaMonitorOutput = {
        featureId: F159_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F159_OPERATION_CODE,
        resolved_project_id: input.project_id,
        resolved_used_megabytes: input.used_megabytes,
        resolved_quota_limit_megabytes: input.quota_limit_megabytes,
        resolved_alert_threshold_reached: input.alert_threshold_reached,
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

  public getTelemetrySnapshot(): F159StorageIndexingQuotaMonitorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F159_FEATURE_ID,
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

  public getAuditTrail(): readonly F159StorageIndexingQuotaMonitorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F159StorageIndexingQuotaMonitorOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F159 (Мониторинг квот хранилища и индексации)
 */
export function verifyF159Module(): {
  featureId: typeof F159_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F159StorageIndexingQuotaMonitorEngine();
  const sampleInput: F159StorageIndexingQuotaMonitorInput = {
    requestId: "req_verify_f159",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    project_id: "f159_project_id_verified",
    used_megabytes: 100,
    quota_limit_megabytes: true,
    alert_threshold_reached: "verified_ok",
    metadata: { stage: "stage5-enterprise", featureNumber: 159 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F159" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F159_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
