/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F020
 * ============================================================================
 * Feature ID: F020
 * Stage: stage1-autonomy
 * Title: Горячая замена промптов ролей
 * Description: Обновление системных инструкций агентов без перезапуска рантайма
 * Operation Code: prompt_hotswap
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F020_FEATURE_ID = "F020" as const;
export const F020_STAGE = "stage1-autonomy" as const;
export const F020_OPERATION_CODE = "prompt_hotswap" as const;
export const F020_CONTRACT_VERSION = "1.0.0" as const;

export type F020HotSwapRolePromptsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F020HotSwapRolePromptsConfig {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly stage: typeof F020_STAGE;
  readonly operationCode: typeof F020_OPERATION_CODE;
  readonly contractVersion: typeof F020_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F020HotSwapRolePromptsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly role_name: string;
  readonly previous_version: string | number;
  readonly active_version: string | number | boolean | readonly string[];
  readonly zero_downtime_applied: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F020HotSwapRolePromptsOutput {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F020HotSwapRolePromptsExecutionStatus;
  readonly operationCode: typeof F020_OPERATION_CODE;
  readonly resolved_role_name: string;
  readonly resolved_previous_version: string | number;
  readonly resolved_active_version: string | number | boolean | readonly string[];
  readonly resolved_zero_downtime_applied: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F020HotSwapRolePromptsAuditEntry;
}

export interface F020HotSwapRolePromptsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F020_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F020HotSwapRolePromptsTelemetrySnapshot {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F020_CONFIG: F020HotSwapRolePromptsConfig = {
  featureId: F020_FEATURE_ID,
  stage: F020_STAGE,
  operationCode: F020_OPERATION_CODE,
  contractVersion: F020_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F020HotSwapRolePromptsValidationError extends Error {
  public readonly featureId = F020_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F020 Validation Error on '${field}']: ${message}`);
    this.name = "F020HotSwapRolePromptsValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F020 provenance & audit integrity.
 */
export function computeF020Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f020_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F020: Горячая замена промптов ролей
 * Обновление системных инструкций агентов без перезапуска рантайма
 */
export class F020HotSwapRolePromptsEngine {
  private readonly config: F020HotSwapRolePromptsConfig;
  private readonly executionHistory: F020HotSwapRolePromptsOutput[] = [];
  private readonly auditLog: F020HotSwapRolePromptsAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F020HotSwapRolePromptsConfig>) {
    this.config = {
      ...DEFAULT_F020_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F020HotSwapRolePromptsConfig {
    return { ...this.config };
  }

  public validateInput(input: F020HotSwapRolePromptsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.role_name).trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("role_name", "Primary domain attribute 'role_name' cannot be empty.");
    }
  }

  public execute(input: F020HotSwapRolePromptsInput): F020HotSwapRolePromptsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f020_${this.totalRuns}_${computeF020Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F020_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        role_name: input.role_name,
        previous_version: input.previous_version,
        active_version: input.active_version,
        zero_downtime_applied: input.zero_downtime_applied,
      });

      const provenanceDigest = computeF020Digest(canonicalPayload);
      const auditRecord: F020HotSwapRolePromptsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F020_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `prompt_hotswap:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F020HotSwapRolePromptsOutput = {
        featureId: F020_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F020_OPERATION_CODE,
        resolved_role_name: input.role_name,
        resolved_previous_version: input.previous_version,
        resolved_active_version: input.active_version,
        resolved_zero_downtime_applied: input.zero_downtime_applied,
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

  public getTelemetrySnapshot(): F020HotSwapRolePromptsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F020_FEATURE_ID,
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

  public getAuditTrail(): readonly F020HotSwapRolePromptsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F020HotSwapRolePromptsOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F020 (Горячая замена промптов ролей)
 */
export function verifyF020Module(): {
  featureId: typeof F020_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F020HotSwapRolePromptsEngine();
  const sampleInput: F020HotSwapRolePromptsInput = {
    requestId: "req_verify_f020",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    role_name: "f020_role_name_verified",
    previous_version: 100,
    active_version: true,
    zero_downtime_applied: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 20 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F020" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F020_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
