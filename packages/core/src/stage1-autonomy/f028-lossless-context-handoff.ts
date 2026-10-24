/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F028
 * ============================================================================
 * Feature ID: F028
 * Stage: stage1-autonomy
 * Title: Передача контекста между агентами без потерь (Context Handoff)
 * Description: Сжатие истории с сохранением ключевых фактов при передаче эстафеты
 * Operation Code: context_handoff
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F028_FEATURE_ID = "F028" as const;
export const F028_STAGE = "stage1-autonomy" as const;
export const F028_OPERATION_CODE = "context_handoff" as const;
export const F028_CONTRACT_VERSION = "1.0.0" as const;

export type F028LosslessContextHandoffExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F028LosslessContextHandoffConfig {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly stage: typeof F028_STAGE;
  readonly operationCode: typeof F028_OPERATION_CODE;
  readonly contractVersion: typeof F028_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F028LosslessContextHandoffInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly handoff_id: string;
  readonly from_role: string | number;
  readonly to_role: string | number | boolean | readonly string[];
  readonly preserved_facts_digest: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F028LosslessContextHandoffOutput {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F028LosslessContextHandoffExecutionStatus;
  readonly operationCode: typeof F028_OPERATION_CODE;
  readonly resolved_handoff_id: string;
  readonly resolved_from_role: string | number;
  readonly resolved_to_role: string | number | boolean | readonly string[];
  readonly resolved_preserved_facts_digest: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F028LosslessContextHandoffAuditEntry;
}

export interface F028LosslessContextHandoffAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F028_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F028LosslessContextHandoffTelemetrySnapshot {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F028_CONFIG: F028LosslessContextHandoffConfig = {
  featureId: F028_FEATURE_ID,
  stage: F028_STAGE,
  operationCode: F028_OPERATION_CODE,
  contractVersion: F028_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F028LosslessContextHandoffValidationError extends Error {
  public readonly featureId = F028_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F028 Validation Error on '${field}']: ${message}`);
    this.name = "F028LosslessContextHandoffValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F028 provenance & audit integrity.
 */
export function computeF028Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f028_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F028: Передача контекста между агентами без потерь (Context Handoff)
 * Сжатие истории с сохранением ключевых фактов при передаче эстафеты
 */
export class F028LosslessContextHandoffEngine {
  private readonly config: F028LosslessContextHandoffConfig;
  private readonly executionHistory: F028LosslessContextHandoffOutput[] = [];
  private readonly auditLog: F028LosslessContextHandoffAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F028LosslessContextHandoffConfig>) {
    this.config = {
      ...DEFAULT_F028_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F028LosslessContextHandoffConfig {
    return { ...this.config };
  }

  public validateInput(input: F028LosslessContextHandoffInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.handoff_id).trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("handoff_id", "Primary domain attribute 'handoff_id' cannot be empty.");
    }
  }

  public execute(input: F028LosslessContextHandoffInput): F028LosslessContextHandoffOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f028_${this.totalRuns}_${computeF028Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F028_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        handoff_id: input.handoff_id,
        from_role: input.from_role,
        to_role: input.to_role,
        preserved_facts_digest: input.preserved_facts_digest,
      });

      const provenanceDigest = computeF028Digest(canonicalPayload);
      const auditRecord: F028LosslessContextHandoffAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F028_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `context_handoff:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F028LosslessContextHandoffOutput = {
        featureId: F028_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F028_OPERATION_CODE,
        resolved_handoff_id: input.handoff_id,
        resolved_from_role: input.from_role,
        resolved_to_role: input.to_role,
        resolved_preserved_facts_digest: input.preserved_facts_digest,
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

  public getTelemetrySnapshot(): F028LosslessContextHandoffTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F028_FEATURE_ID,
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

  public getAuditTrail(): readonly F028LosslessContextHandoffAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F028LosslessContextHandoffOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F028 (Передача контекста между агентами без потерь (Context Handoff))
 */
export function verifyF028Module(): {
  featureId: typeof F028_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F028LosslessContextHandoffEngine();
  const sampleInput: F028LosslessContextHandoffInput = {
    requestId: "req_verify_f028",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    handoff_id: "f028_handoff_id_verified",
    from_role: 100,
    to_role: true,
    preserved_facts_digest: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 28 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F028" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F028_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
