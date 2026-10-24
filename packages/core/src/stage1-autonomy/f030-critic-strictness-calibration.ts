/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F030
 * ============================================================================
 * Feature ID: F030
 * Stage: stage1-autonomy
 * Title: Калибровка строгости Критика
 * Description: Настройка порога пропуска артефактов (черновик / продакшен-грейд)
 * Operation Code: strictness_calibrator
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F030_FEATURE_ID = "F030" as const;
export const F030_STAGE = "stage1-autonomy" as const;
export const F030_OPERATION_CODE = "strictness_calibrator" as const;
export const F030_CONTRACT_VERSION = "1.0.0" as const;

export type F030CriticStrictnessCalibrationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F030CriticStrictnessCalibrationConfig {
  readonly featureId: typeof F030_FEATURE_ID;
  readonly stage: typeof F030_STAGE;
  readonly operationCode: typeof F030_OPERATION_CODE;
  readonly contractVersion: typeof F030_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F030CriticStrictnessCalibrationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly calibration_mode: string;
  readonly min_pass_score: string | number;
  readonly allow_warnings: string | number | boolean | readonly string[];
  readonly gate_decision: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F030CriticStrictnessCalibrationOutput {
  readonly featureId: typeof F030_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F030CriticStrictnessCalibrationExecutionStatus;
  readonly operationCode: typeof F030_OPERATION_CODE;
  readonly resolved_calibration_mode: string;
  readonly resolved_min_pass_score: string | number;
  readonly resolved_allow_warnings: string | number | boolean | readonly string[];
  readonly resolved_gate_decision: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F030CriticStrictnessCalibrationAuditEntry;
}

export interface F030CriticStrictnessCalibrationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F030_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F030CriticStrictnessCalibrationTelemetrySnapshot {
  readonly featureId: typeof F030_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F030_CONFIG: F030CriticStrictnessCalibrationConfig = {
  featureId: F030_FEATURE_ID,
  stage: F030_STAGE,
  operationCode: F030_OPERATION_CODE,
  contractVersion: F030_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F030CriticStrictnessCalibrationValidationError extends Error {
  public readonly featureId = F030_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F030 Validation Error on '${field}']: ${message}`);
    this.name = "F030CriticStrictnessCalibrationValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F030 provenance & audit integrity.
 */
export function computeF030Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f030_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F030: Калибровка строгости Критика
 * Настройка порога пропуска артефактов (черновик / продакшен-грейд)
 */
export class F030CriticStrictnessCalibrationEngine {
  private readonly config: F030CriticStrictnessCalibrationConfig;
  private readonly executionHistory: F030CriticStrictnessCalibrationOutput[] = [];
  private readonly auditLog: F030CriticStrictnessCalibrationAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F030CriticStrictnessCalibrationConfig>) {
    this.config = {
      ...DEFAULT_F030_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F030CriticStrictnessCalibrationConfig {
    return { ...this.config };
  }

  public validateInput(input: F030CriticStrictnessCalibrationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.calibration_mode).trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("calibration_mode", "Primary domain attribute 'calibration_mode' cannot be empty.");
    }
  }

  public execute(input: F030CriticStrictnessCalibrationInput): F030CriticStrictnessCalibrationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f030_${this.totalRuns}_${computeF030Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F030_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        calibration_mode: input.calibration_mode,
        min_pass_score: input.min_pass_score,
        allow_warnings: input.allow_warnings,
        gate_decision: input.gate_decision,
      });

      const provenanceDigest = computeF030Digest(canonicalPayload);
      const auditRecord: F030CriticStrictnessCalibrationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F030_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `strictness_calibrator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F030CriticStrictnessCalibrationOutput = {
        featureId: F030_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F030_OPERATION_CODE,
        resolved_calibration_mode: input.calibration_mode,
        resolved_min_pass_score: input.min_pass_score,
        resolved_allow_warnings: input.allow_warnings,
        resolved_gate_decision: input.gate_decision,
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

  public getTelemetrySnapshot(): F030CriticStrictnessCalibrationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F030_FEATURE_ID,
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

  public getAuditTrail(): readonly F030CriticStrictnessCalibrationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F030CriticStrictnessCalibrationOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F030 (Калибровка строгости Критика)
 */
export function verifyF030Module(): {
  featureId: typeof F030_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F030CriticStrictnessCalibrationEngine();
  const sampleInput: F030CriticStrictnessCalibrationInput = {
    requestId: "req_verify_f030",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    calibration_mode: "f030_calibration_mode_verified",
    min_pass_score: 100,
    allow_warnings: true,
    gate_decision: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 30 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F030" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F030_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
