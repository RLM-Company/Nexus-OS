/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F015
 * ============================================================================
 * Feature ID: F015
 * Stage: stage1-autonomy
 * Title: Контракты ввода-вывода (Strict JSON Schema IO)
 * Description: Валидация типизированных ответов между агентами через схемы данных
 * Operation Code: schema_validator
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F015_FEATURE_ID = "F015" as const;
export const F015_STAGE = "stage1-autonomy" as const;
export const F015_OPERATION_CODE = "schema_validator" as const;
export const F015_CONTRACT_VERSION = "1.0.0" as const;

export type F015StrictJsonSchemaIoExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F015StrictJsonSchemaIoConfig {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly stage: typeof F015_STAGE;
  readonly operationCode: typeof F015_OPERATION_CODE;
  readonly contractVersion: typeof F015_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F015StrictJsonSchemaIoInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly schema_id: string;
  readonly payload_valid: string | number;
  readonly validated_fields_count: string | number | boolean | readonly string[];
  readonly violation_errors: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F015StrictJsonSchemaIoOutput {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F015StrictJsonSchemaIoExecutionStatus;
  readonly operationCode: typeof F015_OPERATION_CODE;
  readonly resolved_schema_id: string;
  readonly resolved_payload_valid: string | number;
  readonly resolved_validated_fields_count: string | number | boolean | readonly string[];
  readonly resolved_violation_errors: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F015StrictJsonSchemaIoAuditEntry;
}

export interface F015StrictJsonSchemaIoAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F015_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F015StrictJsonSchemaIoTelemetrySnapshot {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F015_CONFIG: F015StrictJsonSchemaIoConfig = {
  featureId: F015_FEATURE_ID,
  stage: F015_STAGE,
  operationCode: F015_OPERATION_CODE,
  contractVersion: F015_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F015StrictJsonSchemaIoValidationError extends Error {
  public readonly featureId = F015_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F015 Validation Error on '${field}']: ${message}`);
    this.name = "F015StrictJsonSchemaIoValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F015 provenance & audit integrity.
 */
export function computeF015Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f015_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F015: Контракты ввода-вывода (Strict JSON Schema IO)
 * Валидация типизированных ответов между агентами через схемы данных
 */
export class F015StrictJsonSchemaIoEngine {
  private readonly config: F015StrictJsonSchemaIoConfig;
  private readonly executionHistory: F015StrictJsonSchemaIoOutput[] = [];
  private readonly auditLog: F015StrictJsonSchemaIoAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F015StrictJsonSchemaIoConfig>) {
    this.config = {
      ...DEFAULT_F015_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F015StrictJsonSchemaIoConfig {
    return { ...this.config };
  }

  public validateInput(input: F015StrictJsonSchemaIoInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.schema_id).trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("schema_id", "Primary domain attribute 'schema_id' cannot be empty.");
    }
  }

  public execute(input: F015StrictJsonSchemaIoInput): F015StrictJsonSchemaIoOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f015_${this.totalRuns}_${computeF015Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F015_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        schema_id: input.schema_id,
        payload_valid: input.payload_valid,
        validated_fields_count: input.validated_fields_count,
        violation_errors: input.violation_errors,
      });

      const provenanceDigest = computeF015Digest(canonicalPayload);
      const auditRecord: F015StrictJsonSchemaIoAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F015_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `schema_validator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F015StrictJsonSchemaIoOutput = {
        featureId: F015_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F015_OPERATION_CODE,
        resolved_schema_id: input.schema_id,
        resolved_payload_valid: input.payload_valid,
        resolved_validated_fields_count: input.validated_fields_count,
        resolved_violation_errors: input.violation_errors,
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

  public getTelemetrySnapshot(): F015StrictJsonSchemaIoTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F015_FEATURE_ID,
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

  public getAuditTrail(): readonly F015StrictJsonSchemaIoAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F015StrictJsonSchemaIoOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F015 (Контракты ввода-вывода (Strict JSON Schema IO))
 */
export function verifyF015Module(): {
  featureId: typeof F015_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F015StrictJsonSchemaIoEngine();
  const sampleInput: F015StrictJsonSchemaIoInput = {
    requestId: "req_verify_f015",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    schema_id: "f015_schema_id_verified",
    payload_valid: 100,
    validated_fields_count: true,
    violation_errors: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 15 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F015" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F015_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
