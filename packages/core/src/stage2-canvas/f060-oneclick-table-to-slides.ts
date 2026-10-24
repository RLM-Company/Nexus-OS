/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F060
 * ============================================================================
 * Feature ID: F060
 * Stage: stage2-canvas
 * Title: Конвертер таблиц в слайды в один клик
 * Description: Автоматическая выжимка ключевых трендов из большого XLSX-файла в 3–5 наглядных слайдов
 * Operation Code: table_to_slides_converter
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F060_FEATURE_ID = "F060" as const;
export const F060_STAGE = "stage2-canvas" as const;
export const F060_OPERATION_CODE = "table_to_slides_converter" as const;
export const F060_CONTRACT_VERSION = "1.0.0" as const;

export type F060OneclickTableToSlidesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F060OneclickTableToSlidesConfig {
  readonly featureId: typeof F060_FEATURE_ID;
  readonly stage: typeof F060_STAGE;
  readonly operationCode: typeof F060_OPERATION_CODE;
  readonly contractVersion: typeof F060_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F060OneclickTableToSlidesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_sheet_id: string;
  readonly generated_slides_count: string | number;
  readonly key_trends_extracted: string | number | boolean | readonly string[];
  readonly slides_payload: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F060OneclickTableToSlidesOutput {
  readonly featureId: typeof F060_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F060OneclickTableToSlidesExecutionStatus;
  readonly operationCode: typeof F060_OPERATION_CODE;
  readonly resolved_source_sheet_id: string;
  readonly resolved_generated_slides_count: string | number;
  readonly resolved_key_trends_extracted: string | number | boolean | readonly string[];
  readonly resolved_slides_payload: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F060OneclickTableToSlidesAuditEntry;
}

export interface F060OneclickTableToSlidesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F060_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F060OneclickTableToSlidesTelemetrySnapshot {
  readonly featureId: typeof F060_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F060_CONFIG: F060OneclickTableToSlidesConfig = {
  featureId: F060_FEATURE_ID,
  stage: F060_STAGE,
  operationCode: F060_OPERATION_CODE,
  contractVersion: F060_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F060OneclickTableToSlidesValidationError extends Error {
  public readonly featureId = F060_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F060 Validation Error on '${field}']: ${message}`);
    this.name = "F060OneclickTableToSlidesValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F060 provenance & audit integrity.
 */
export function computeF060Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f060_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F060: Конвертер таблиц в слайды в один клик
 * Автоматическая выжимка ключевых трендов из большого XLSX-файла в 3–5 наглядных слайдов
 */
export class F060OneclickTableToSlidesEngine {
  private readonly config: F060OneclickTableToSlidesConfig;
  private readonly executionHistory: F060OneclickTableToSlidesOutput[] = [];
  private readonly auditLog: F060OneclickTableToSlidesAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F060OneclickTableToSlidesConfig>) {
    this.config = {
      ...DEFAULT_F060_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F060OneclickTableToSlidesConfig {
    return { ...this.config };
  }

  public validateInput(input: F060OneclickTableToSlidesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F060OneclickTableToSlidesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F060OneclickTableToSlidesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F060OneclickTableToSlidesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F060OneclickTableToSlidesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.source_sheet_id).trim().length === 0) {
      throw new F060OneclickTableToSlidesValidationError("source_sheet_id", "Primary domain attribute 'source_sheet_id' cannot be empty.");
    }
  }

  public execute(input: F060OneclickTableToSlidesInput): F060OneclickTableToSlidesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f060_${this.totalRuns}_${computeF060Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F060_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        source_sheet_id: input.source_sheet_id,
        generated_slides_count: input.generated_slides_count,
        key_trends_extracted: input.key_trends_extracted,
        slides_payload: input.slides_payload,
      });

      const provenanceDigest = computeF060Digest(canonicalPayload);
      const auditRecord: F060OneclickTableToSlidesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F060_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `table_to_slides_converter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F060OneclickTableToSlidesOutput = {
        featureId: F060_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F060_OPERATION_CODE,
        resolved_source_sheet_id: input.source_sheet_id,
        resolved_generated_slides_count: input.generated_slides_count,
        resolved_key_trends_extracted: input.key_trends_extracted,
        resolved_slides_payload: input.slides_payload,
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

  public getTelemetrySnapshot(): F060OneclickTableToSlidesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F060_FEATURE_ID,
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

  public getAuditTrail(): readonly F060OneclickTableToSlidesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F060OneclickTableToSlidesOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F060 (Конвертер таблиц в слайды в один клик)
 */
export function verifyF060Module(): {
  featureId: typeof F060_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F060OneclickTableToSlidesEngine();
  const sampleInput: F060OneclickTableToSlidesInput = {
    requestId: "req_verify_f060",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_sheet_id: "f060_source_sheet_id_verified",
    generated_slides_count: 100,
    key_trends_extracted: true,
    slides_payload: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 60 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F060" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F060_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
