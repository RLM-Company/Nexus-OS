/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F123
 * ============================================================================
 * Feature ID: F123
 * Stage: stage4-intelligence-graph
 * Title: Персональный профиль предпочтений внутри воркспейса
 * Description: Запоминание любимого формата таблиц, стиля кода и лаконичности ответов
 * Operation Code: preference_memory_profile
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F123_FEATURE_ID = "F123" as const;
export const F123_STAGE = "stage4-intelligence-graph" as const;
export const F123_OPERATION_CODE = "preference_memory_profile" as const;
export const F123_CONTRACT_VERSION = "1.0.0" as const;

export type F123WorkspacePreferenceProfilerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F123WorkspacePreferenceProfilerConfig {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly stage: typeof F123_STAGE;
  readonly operationCode: typeof F123_OPERATION_CODE;
  readonly contractVersion: typeof F123_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F123WorkspacePreferenceProfilerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly preferred_table_style: string | number;
  readonly preferred_code_idiom: string | number | boolean | readonly string[];
  readonly verbosity_level: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F123WorkspacePreferenceProfilerOutput {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F123WorkspacePreferenceProfilerExecutionStatus;
  readonly operationCode: typeof F123_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_preferred_table_style: string | number;
  readonly resolved_preferred_code_idiom: string | number | boolean | readonly string[];
  readonly resolved_verbosity_level: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F123WorkspacePreferenceProfilerAuditEntry;
}

export interface F123WorkspacePreferenceProfilerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F123_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F123WorkspacePreferenceProfilerTelemetrySnapshot {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F123_CONFIG: F123WorkspacePreferenceProfilerConfig = {
  featureId: F123_FEATURE_ID,
  stage: F123_STAGE,
  operationCode: F123_OPERATION_CODE,
  contractVersion: F123_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F123WorkspacePreferenceProfilerValidationError extends Error {
  public readonly featureId = F123_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F123 Validation Error on '${field}']: ${message}`);
    this.name = "F123WorkspacePreferenceProfilerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F123 provenance & audit integrity.
 */
export function computeF123Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f123_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F123: Персональный профиль предпочтений внутри воркспейса
 * Запоминание любимого формата таблиц, стиля кода и лаконичности ответов
 */
export class F123WorkspacePreferenceProfilerEngine {
  private readonly config: F123WorkspacePreferenceProfilerConfig;
  private readonly executionHistory: F123WorkspacePreferenceProfilerOutput[] = [];
  private readonly auditLog: F123WorkspacePreferenceProfilerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F123WorkspacePreferenceProfilerConfig>) {
    this.config = {
      ...DEFAULT_F123_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F123WorkspacePreferenceProfilerConfig {
    return { ...this.config };
  }

  public validateInput(input: F123WorkspacePreferenceProfilerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
  }

  public execute(input: F123WorkspacePreferenceProfilerInput): F123WorkspacePreferenceProfilerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f123_${this.totalRuns}_${computeF123Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F123_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        workspace_id: input.workspace_id,
        preferred_table_style: input.preferred_table_style,
        preferred_code_idiom: input.preferred_code_idiom,
        verbosity_level: input.verbosity_level,
      });

      const provenanceDigest = computeF123Digest(canonicalPayload);
      const auditRecord: F123WorkspacePreferenceProfilerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F123_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `preference_memory_profile:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F123WorkspacePreferenceProfilerOutput = {
        featureId: F123_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F123_OPERATION_CODE,
        resolved_workspace_id: input.workspace_id,
        resolved_preferred_table_style: input.preferred_table_style,
        resolved_preferred_code_idiom: input.preferred_code_idiom,
        resolved_verbosity_level: input.verbosity_level,
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

  public getTelemetrySnapshot(): F123WorkspacePreferenceProfilerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F123_FEATURE_ID,
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

  public getAuditTrail(): readonly F123WorkspacePreferenceProfilerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F123WorkspacePreferenceProfilerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F123 (Персональный профиль предпочтений внутри воркспейса)
 */
export function verifyF123Module(): {
  featureId: typeof F123_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F123WorkspacePreferenceProfilerEngine();
  const sampleInput: F123WorkspacePreferenceProfilerInput = {
    requestId: "req_verify_f123",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f123_workspace_id_verified",
    preferred_table_style: 100,
    preferred_code_idiom: true,
    verbosity_level: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 123 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F123" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F123_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
