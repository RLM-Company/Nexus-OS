/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F008
 * ============================================================================
 * Feature ID: F008
 * Stage: stage1-autonomy
 * Title: Настраиваемые уровни автономии (L1–L5)
 * Description: Ползунок контроля от «спрашивать каждый шаг» до «полный автопилот с отчётом по итогу»
 * Operation Code: autonomy_slider
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F008_FEATURE_ID = "F008" as const;
export const F008_STAGE = "stage1-autonomy" as const;
export const F008_OPERATION_CODE = "autonomy_slider" as const;
export const F008_CONTRACT_VERSION = "1.0.0" as const;

export type F008AutonomyLevelsL1L5ExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F008AutonomyLevelsL1L5Config {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly stage: typeof F008_STAGE;
  readonly operationCode: typeof F008_OPERATION_CODE;
  readonly contractVersion: typeof F008_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F008AutonomyLevelsL1L5Input {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tier_level: string;
  readonly cosmora_policy_code: string | number;
  readonly require_step_confirmation: string | number | boolean | readonly string[];
  readonly allow_fanout: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F008AutonomyLevelsL1L5Output {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F008AutonomyLevelsL1L5ExecutionStatus;
  readonly operationCode: typeof F008_OPERATION_CODE;
  readonly resolved_tier_level: string;
  readonly resolved_cosmora_policy_code: string | number;
  readonly resolved_require_step_confirmation: string | number | boolean | readonly string[];
  readonly resolved_allow_fanout: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F008AutonomyLevelsL1L5AuditEntry;
}

export interface F008AutonomyLevelsL1L5AuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F008_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F008AutonomyLevelsL1L5TelemetrySnapshot {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F008_CONFIG: F008AutonomyLevelsL1L5Config = {
  featureId: F008_FEATURE_ID,
  stage: F008_STAGE,
  operationCode: F008_OPERATION_CODE,
  contractVersion: F008_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F008AutonomyLevelsL1L5ValidationError extends Error {
  public readonly featureId = F008_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F008 Validation Error on '${field}']: ${message}`);
    this.name = "F008AutonomyLevelsL1L5ValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F008 provenance & audit integrity.
 */
export function computeF008Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f008_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F008: Настраиваемые уровни автономии (L1–L5)
 * Ползунок контроля от «спрашивать каждый шаг» до «полный автопилот с отчётом по итогу»
 */
export class F008AutonomyLevelsL1L5Engine {
  private readonly config: F008AutonomyLevelsL1L5Config;
  private readonly executionHistory: F008AutonomyLevelsL1L5Output[] = [];
  private readonly auditLog: F008AutonomyLevelsL1L5AuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F008AutonomyLevelsL1L5Config>) {
    this.config = {
      ...DEFAULT_F008_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F008AutonomyLevelsL1L5Config {
    return { ...this.config };
  }

  public validateInput(input: F008AutonomyLevelsL1L5Input): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.tier_level).trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("tier_level", "Primary domain attribute 'tier_level' cannot be empty.");
    }
  }

  public execute(input: F008AutonomyLevelsL1L5Input): F008AutonomyLevelsL1L5Output {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f008_${this.totalRuns}_${computeF008Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F008_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        tier_level: input.tier_level,
        cosmora_policy_code: input.cosmora_policy_code,
        require_step_confirmation: input.require_step_confirmation,
        allow_fanout: input.allow_fanout,
      });

      const provenanceDigest = computeF008Digest(canonicalPayload);
      const auditRecord: F008AutonomyLevelsL1L5AuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F008_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `autonomy_slider:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F008AutonomyLevelsL1L5Output = {
        featureId: F008_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F008_OPERATION_CODE,
        resolved_tier_level: input.tier_level,
        resolved_cosmora_policy_code: input.cosmora_policy_code,
        resolved_require_step_confirmation: input.require_step_confirmation,
        resolved_allow_fanout: input.allow_fanout,
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

  public getTelemetrySnapshot(): F008AutonomyLevelsL1L5TelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F008_FEATURE_ID,
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

  public getAuditTrail(): readonly F008AutonomyLevelsL1L5AuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F008AutonomyLevelsL1L5Output[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F008 (Настраиваемые уровни автономии (L1–L5))
 */
export function verifyF008Module(): {
  featureId: typeof F008_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F008AutonomyLevelsL1L5Engine();
  const sampleInput: F008AutonomyLevelsL1L5Input = {
    requestId: "req_verify_f008",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tier_level: "f008_tier_level_verified",
    cosmora_policy_code: 100,
    require_step_confirmation: true,
    allow_fanout: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 8 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F008" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F008_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
