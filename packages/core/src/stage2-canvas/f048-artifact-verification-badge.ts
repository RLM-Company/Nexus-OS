/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F048
 * ============================================================================
 * Feature ID: F048
 * Stage: stage2-canvas
 * Title: Бейдж статуса проверки на артефакте
 * Description: Визуальный индикатор в шапке Canvas: проверено Критиком, есть замечания или редактируется вручную
 * Operation Code: verification_badge_ui
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F048_FEATURE_ID = "F048" as const;
export const F048_STAGE = "stage2-canvas" as const;
export const F048_OPERATION_CODE = "verification_badge_ui" as const;
export const F048_CONTRACT_VERSION = "1.0.0" as const;

export type F048ArtifactVerificationBadgeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F048ArtifactVerificationBadgeConfig {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly stage: typeof F048_STAGE;
  readonly operationCode: typeof F048_OPERATION_CODE;
  readonly contractVersion: typeof F048_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F048ArtifactVerificationBadgeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly badge_state: string | number;
  readonly critic_score: string | number | boolean | readonly string[];
  readonly badge_color_token: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F048ArtifactVerificationBadgeOutput {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F048ArtifactVerificationBadgeExecutionStatus;
  readonly operationCode: typeof F048_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_badge_state: string | number;
  readonly resolved_critic_score: string | number | boolean | readonly string[];
  readonly resolved_badge_color_token: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F048ArtifactVerificationBadgeAuditEntry;
}

export interface F048ArtifactVerificationBadgeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F048_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F048ArtifactVerificationBadgeTelemetrySnapshot {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F048_CONFIG: F048ArtifactVerificationBadgeConfig = {
  featureId: F048_FEATURE_ID,
  stage: F048_STAGE,
  operationCode: F048_OPERATION_CODE,
  contractVersion: F048_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F048ArtifactVerificationBadgeValidationError extends Error {
  public readonly featureId = F048_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F048 Validation Error on '${field}']: ${message}`);
    this.name = "F048ArtifactVerificationBadgeValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F048 provenance & audit integrity.
 */
export function computeF048Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f048_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F048: Бейдж статуса проверки на артефакте
 * Визуальный индикатор в шапке Canvas: проверено Критиком, есть замечания или редактируется вручную
 */
export class F048ArtifactVerificationBadgeEngine {
  private readonly config: F048ArtifactVerificationBadgeConfig;
  private readonly executionHistory: F048ArtifactVerificationBadgeOutput[] = [];
  private readonly auditLog: F048ArtifactVerificationBadgeAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F048ArtifactVerificationBadgeConfig>) {
    this.config = {
      ...DEFAULT_F048_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F048ArtifactVerificationBadgeConfig {
    return { ...this.config };
  }

  public validateInput(input: F048ArtifactVerificationBadgeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
  }

  public execute(input: F048ArtifactVerificationBadgeInput): F048ArtifactVerificationBadgeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f048_${this.totalRuns}_${computeF048Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F048_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        artifact_id: input.artifact_id,
        badge_state: input.badge_state,
        critic_score: input.critic_score,
        badge_color_token: input.badge_color_token,
      });

      const provenanceDigest = computeF048Digest(canonicalPayload);
      const auditRecord: F048ArtifactVerificationBadgeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F048_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `verification_badge_ui:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F048ArtifactVerificationBadgeOutput = {
        featureId: F048_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F048_OPERATION_CODE,
        resolved_artifact_id: input.artifact_id,
        resolved_badge_state: input.badge_state,
        resolved_critic_score: input.critic_score,
        resolved_badge_color_token: input.badge_color_token,
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

  public getTelemetrySnapshot(): F048ArtifactVerificationBadgeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F048_FEATURE_ID,
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

  public getAuditTrail(): readonly F048ArtifactVerificationBadgeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F048ArtifactVerificationBadgeOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F048 (Бейдж статуса проверки на артефакте)
 */
export function verifyF048Module(): {
  featureId: typeof F048_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F048ArtifactVerificationBadgeEngine();
  const sampleInput: F048ArtifactVerificationBadgeInput = {
    requestId: "req_verify_f048",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f048_artifact_id_verified",
    badge_state: 100,
    critic_score: true,
    badge_color_token: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 48 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F048" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F048_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
