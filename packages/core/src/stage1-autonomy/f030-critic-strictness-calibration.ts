/**
 * F030 (stage1-autonomy): Калибровка строгости Критика
 * Настройка порога пропуска артефактов (черновик / продакшен-грейд)
 * Operation Code: strictness_calibrator
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F030_FEATURE_ID = "F030" as const;
export const F030_STAGE = "stage1-autonomy" as const;
export const F030_OPERATION_CODE = "strictness_calibrator" as const;
export const F030_CONTRACT_VERSION = "2.0.0" as const;

export type F030CriticStrictnessCalibrationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
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
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F030CriticStrictnessCalibrationAuditEntry;
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
  strictValidation: true
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

export function computeF030Digest(rawPayload: string): string {
  return `f030_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F030CriticStrictnessCalibrationEngine {
  private readonly config: F030CriticStrictnessCalibrationConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F030CriticStrictnessCalibrationOutput[] = [];
  private readonly auditLog: F030CriticStrictnessCalibrationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F030CriticStrictnessCalibrationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F030CriticStrictnessCalibrationConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F030_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F030CriticStrictnessCalibrationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
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
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F030CriticStrictnessCalibrationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.calibration_mode).trim().length === 0) {
      throw new F030CriticStrictnessCalibrationValidationError("calibration_mode", "Primary domain attribute 'calibration_mode' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      calibration_mode: input.calibration_mode,
      min_pass_score: input.min_pass_score,
      allow_warnings: input.allow_warnings,
      gate_decision: input.gate_decision
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F030CriticStrictnessCalibrationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F030CriticStrictnessCalibrationInput): F030CriticStrictnessCalibrationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F030_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        calibration_mode: input.calibration_mode,
        min_pass_score: input.min_pass_score,
        allow_warnings: input.allow_warnings,
        gate_decision: input.gate_decision
      });
      const payloadHash = computeF030Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F030CriticStrictnessCalibrationValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F030_FEATURE_ID,
        operationCode: F030_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          calibration_mode: input.calibration_mode,
          min_pass_score: input.min_pass_score,
          allow_warnings: input.allow_warnings,
          gate_decision: input.gate_decision
        }
      });

      const executionId = `exec_f030_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f030_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F030CriticStrictnessCalibrationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F030_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `strictness_calibrator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
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
        resolved_calibration_mode: kernelResult.resolvedFields.calibration_mode as string,
        resolved_min_pass_score: kernelResult.resolvedFields.min_pass_score as string | number,
        resolved_allow_warnings: kernelResult.resolvedFields.allow_warnings as string | number | boolean | readonly string[],
        resolved_gate_decision: kernelResult.resolvedFields.gate_decision as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
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
          : 0
    };
  }

  public getAuditTrail(): readonly F030CriticStrictnessCalibrationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F030CriticStrictnessCalibrationOutput[] {
    return [...this.executionHistory];
  }
}

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
    calibration_mode: "f030_calibration_mode_seed",
    min_pass_score: 42,
    allow_warnings: true,
    gate_decision: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 30 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F030" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_calibration_mode !== sampleInput.calibration_mode &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F030_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
