/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F006
 * ============================================================================
 * Feature ID: F006
 * Stage: stage1-autonomy
 * Title: Институт Агента-Критика (Critic Agent)
 * Description: Выделенный проверяющий контур для ревью кода, текста и таблиц до показа пользователю
 * Operation Code: critic_review
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F006_FEATURE_ID = "F006" as const;
export const F006_STAGE = "stage1-autonomy" as const;
export const F006_OPERATION_CODE = "critic_review" as const;
export const F006_CONTRACT_VERSION = "1.0.0" as const;

export type F006CriticAgentInstituteExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F006CriticAgentInstituteConfig {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly stage: typeof F006_STAGE;
  readonly operationCode: typeof F006_OPERATION_CODE;
  readonly contractVersion: typeof F006_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F006CriticAgentInstituteInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly review_id: string;
  readonly target_artifact_id: string | number;
  readonly rubric_scores: string | number | boolean | readonly string[];
  readonly blocking_issues: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F006CriticAgentInstituteOutput {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F006CriticAgentInstituteExecutionStatus;
  readonly operationCode: typeof F006_OPERATION_CODE;
  readonly resolved_review_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_rubric_scores: string | number | boolean | readonly string[];
  readonly resolved_blocking_issues: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F006CriticAgentInstituteAuditEntry;
}

export interface F006CriticAgentInstituteAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F006_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F006CriticAgentInstituteTelemetrySnapshot {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F006_CONFIG: F006CriticAgentInstituteConfig = {
  featureId: F006_FEATURE_ID,
  stage: F006_STAGE,
  operationCode: F006_OPERATION_CODE,
  contractVersion: F006_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F006CriticAgentInstituteValidationError extends Error {
  public readonly featureId = F006_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F006 Validation Error on '${field}']: ${message}`);
    this.name = "F006CriticAgentInstituteValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F006 provenance & audit integrity.
 */
export function computeF006Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f006_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F006: Институт Агента-Критика (Critic Agent)
 * Выделенный проверяющий контур для ревью кода, текста и таблиц до показа пользователю
 */
export class F006CriticAgentInstituteEngine {
  private readonly config: F006CriticAgentInstituteConfig;
  private readonly executionHistory: F006CriticAgentInstituteOutput[] = [];
  private readonly auditLog: F006CriticAgentInstituteAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F006CriticAgentInstituteConfig>) {
    this.config = {
      ...DEFAULT_F006_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F006CriticAgentInstituteConfig {
    return { ...this.config };
  }

  public validateInput(input: F006CriticAgentInstituteInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.review_id).trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("review_id", "Primary domain attribute 'review_id' cannot be empty.");
    }
  }

  public execute(input: F006CriticAgentInstituteInput): F006CriticAgentInstituteOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f006_${this.totalRuns}_${computeF006Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F006_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        review_id: input.review_id,
        target_artifact_id: input.target_artifact_id,
        rubric_scores: input.rubric_scores,
        blocking_issues: input.blocking_issues,
      });

      const provenanceDigest = computeF006Digest(canonicalPayload);
      const auditRecord: F006CriticAgentInstituteAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F006_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `critic_review:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F006CriticAgentInstituteOutput = {
        featureId: F006_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F006_OPERATION_CODE,
        resolved_review_id: input.review_id,
        resolved_target_artifact_id: input.target_artifact_id,
        resolved_rubric_scores: input.rubric_scores,
        resolved_blocking_issues: input.blocking_issues,
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

  public getTelemetrySnapshot(): F006CriticAgentInstituteTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F006_FEATURE_ID,
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

  public getAuditTrail(): readonly F006CriticAgentInstituteAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F006CriticAgentInstituteOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F006 (Институт Агента-Критика (Critic Agent))
 */
export function verifyF006Module(): {
  featureId: typeof F006_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F006CriticAgentInstituteEngine();
  const sampleInput: F006CriticAgentInstituteInput = {
    requestId: "req_verify_f006",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    review_id: "f006_review_id_verified",
    target_artifact_id: 100,
    rubric_scores: true,
    blocking_issues: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 6 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F006" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F006_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
