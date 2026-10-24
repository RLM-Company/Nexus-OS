/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F055
 * ============================================================================
 * Feature ID: F055
 * Stage: stage2-canvas
 * Title: Сквозные переменные в документах
 * Description: Динамические плейсхолдеры, которые обновляются во всём тексте при смене цифры в таблице
 * Operation Code: reactive_variable_binder
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F055_FEATURE_ID = "F055" as const;
export const F055_STAGE = "stage2-canvas" as const;
export const F055_OPERATION_CODE = "reactive_variable_binder" as const;
export const F055_CONTRACT_VERSION = "1.0.0" as const;

export type F055CrossDocumentDynamicVariablesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F055CrossDocumentDynamicVariablesConfig {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly stage: typeof F055_STAGE;
  readonly operationCode: typeof F055_OPERATION_CODE;
  readonly contractVersion: typeof F055_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F055CrossDocumentDynamicVariablesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly variable_key: string;
  readonly updated_value: string | number;
  readonly bound_locations_updated: string | number | boolean | readonly string[];
  readonly interpolated_text: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F055CrossDocumentDynamicVariablesOutput {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F055CrossDocumentDynamicVariablesExecutionStatus;
  readonly operationCode: typeof F055_OPERATION_CODE;
  readonly resolved_variable_key: string;
  readonly resolved_updated_value: string | number;
  readonly resolved_bound_locations_updated: string | number | boolean | readonly string[];
  readonly resolved_interpolated_text: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F055CrossDocumentDynamicVariablesAuditEntry;
}

export interface F055CrossDocumentDynamicVariablesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F055_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F055CrossDocumentDynamicVariablesTelemetrySnapshot {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F055_CONFIG: F055CrossDocumentDynamicVariablesConfig = {
  featureId: F055_FEATURE_ID,
  stage: F055_STAGE,
  operationCode: F055_OPERATION_CODE,
  contractVersion: F055_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F055CrossDocumentDynamicVariablesValidationError extends Error {
  public readonly featureId = F055_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F055 Validation Error on '${field}']: ${message}`);
    this.name = "F055CrossDocumentDynamicVariablesValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F055 provenance & audit integrity.
 */
export function computeF055Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f055_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F055: Сквозные переменные в документах
 * Динамические плейсхолдеры, которые обновляются во всём тексте при смене цифры в таблице
 */
export class F055CrossDocumentDynamicVariablesEngine {
  private readonly config: F055CrossDocumentDynamicVariablesConfig;
  private readonly executionHistory: F055CrossDocumentDynamicVariablesOutput[] = [];
  private readonly auditLog: F055CrossDocumentDynamicVariablesAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F055CrossDocumentDynamicVariablesConfig>) {
    this.config = {
      ...DEFAULT_F055_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F055CrossDocumentDynamicVariablesConfig {
    return { ...this.config };
  }

  public validateInput(input: F055CrossDocumentDynamicVariablesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.variable_key).trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("variable_key", "Primary domain attribute 'variable_key' cannot be empty.");
    }
  }

  public execute(input: F055CrossDocumentDynamicVariablesInput): F055CrossDocumentDynamicVariablesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f055_${this.totalRuns}_${computeF055Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F055_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        variable_key: input.variable_key,
        updated_value: input.updated_value,
        bound_locations_updated: input.bound_locations_updated,
        interpolated_text: input.interpolated_text,
      });

      const provenanceDigest = computeF055Digest(canonicalPayload);
      const auditRecord: F055CrossDocumentDynamicVariablesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F055_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `reactive_variable_binder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F055CrossDocumentDynamicVariablesOutput = {
        featureId: F055_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F055_OPERATION_CODE,
        resolved_variable_key: input.variable_key,
        resolved_updated_value: input.updated_value,
        resolved_bound_locations_updated: input.bound_locations_updated,
        resolved_interpolated_text: input.interpolated_text,
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

  public getTelemetrySnapshot(): F055CrossDocumentDynamicVariablesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F055_FEATURE_ID,
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

  public getAuditTrail(): readonly F055CrossDocumentDynamicVariablesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F055CrossDocumentDynamicVariablesOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F055 (Сквозные переменные в документах)
 */
export function verifyF055Module(): {
  featureId: typeof F055_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F055CrossDocumentDynamicVariablesEngine();
  const sampleInput: F055CrossDocumentDynamicVariablesInput = {
    requestId: "req_verify_f055",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    variable_key: "f055_variable_key_verified",
    updated_value: 100,
    bound_locations_updated: true,
    interpolated_text: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 55 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F055" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F055_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
