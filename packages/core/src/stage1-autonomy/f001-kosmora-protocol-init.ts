/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F001
 * ============================================================================
 * Feature ID: F001
 * Stage: stage1-autonomy
 * Title: Инициализация протокола Kosmora
 * Description: Единый стандарт обмена сообщениями и состояниями между оркестратором и воркерами
 * Operation Code: protocol_handshake
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F001_FEATURE_ID = "F001" as const;
export const F001_STAGE = "stage1-autonomy" as const;
export const F001_OPERATION_CODE = "protocol_handshake" as const;
export const F001_CONTRACT_VERSION = "1.0.0" as const;

export type F001KosmoraProtocolInitExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F001KosmoraProtocolInitConfig {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly stage: typeof F001_STAGE;
  readonly operationCode: typeof F001_OPERATION_CODE;
  readonly contractVersion: typeof F001_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F001KosmoraProtocolInitInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly protocol_version: string;
  readonly sender_role: string | number;
  readonly recipient_role: string | number | boolean | readonly string[];
  readonly correlation_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F001KosmoraProtocolInitOutput {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F001KosmoraProtocolInitExecutionStatus;
  readonly operationCode: typeof F001_OPERATION_CODE;
  readonly resolved_protocol_version: string;
  readonly resolved_sender_role: string | number;
  readonly resolved_recipient_role: string | number | boolean | readonly string[];
  readonly resolved_correlation_id: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F001KosmoraProtocolInitAuditEntry;
}

export interface F001KosmoraProtocolInitAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F001_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F001KosmoraProtocolInitTelemetrySnapshot {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F001_CONFIG: F001KosmoraProtocolInitConfig = {
  featureId: F001_FEATURE_ID,
  stage: F001_STAGE,
  operationCode: F001_OPERATION_CODE,
  contractVersion: F001_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F001KosmoraProtocolInitValidationError extends Error {
  public readonly featureId = F001_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F001 Validation Error on '${field}']: ${message}`);
    this.name = "F001KosmoraProtocolInitValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F001 provenance & audit integrity.
 */
export function computeF001Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f001_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F001: Инициализация протокола Kosmora
 * Единый стандарт обмена сообщениями и состояниями между оркестратором и воркерами
 */
export class F001KosmoraProtocolInitEngine {
  private readonly config: F001KosmoraProtocolInitConfig;
  private readonly executionHistory: F001KosmoraProtocolInitOutput[] = [];
  private readonly auditLog: F001KosmoraProtocolInitAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F001KosmoraProtocolInitConfig>) {
    this.config = {
      ...DEFAULT_F001_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F001KosmoraProtocolInitConfig {
    return { ...this.config };
  }

  public validateInput(input: F001KosmoraProtocolInitInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.protocol_version).trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("protocol_version", "Primary domain attribute 'protocol_version' cannot be empty.");
    }
  }

  public execute(input: F001KosmoraProtocolInitInput): F001KosmoraProtocolInitOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f001_${this.totalRuns}_${computeF001Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F001_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        protocol_version: input.protocol_version,
        sender_role: input.sender_role,
        recipient_role: input.recipient_role,
        correlation_id: input.correlation_id,
      });

      const provenanceDigest = computeF001Digest(canonicalPayload);
      const auditRecord: F001KosmoraProtocolInitAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F001_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `protocol_handshake:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F001KosmoraProtocolInitOutput = {
        featureId: F001_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F001_OPERATION_CODE,
        resolved_protocol_version: input.protocol_version,
        resolved_sender_role: input.sender_role,
        resolved_recipient_role: input.recipient_role,
        resolved_correlation_id: input.correlation_id,
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

  public getTelemetrySnapshot(): F001KosmoraProtocolInitTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F001_FEATURE_ID,
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

  public getAuditTrail(): readonly F001KosmoraProtocolInitAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F001KosmoraProtocolInitOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F001 (Инициализация протокола Kosmora)
 */
export function verifyF001Module(): {
  featureId: typeof F001_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F001KosmoraProtocolInitEngine();
  const sampleInput: F001KosmoraProtocolInitInput = {
    requestId: "req_verify_f001",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    protocol_version: "f001_protocol_version_verified",
    sender_role: 100,
    recipient_role: true,
    correlation_id: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 1 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F001" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F001_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
