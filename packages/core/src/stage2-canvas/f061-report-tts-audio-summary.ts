/**
 * F061 (stage2-canvas): Аудио-озвучка отчёта (TTS Summary)
 * Генерация краткого голосового брифинга по длинному аналитическому документу
 * Operation Code: tts_briefing_generator
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F061_FEATURE_ID = "F061" as const;
export const F061_STAGE = "stage2-canvas" as const;
export const F061_OPERATION_CODE = "tts_briefing_generator" as const;
export const F061_CONTRACT_VERSION = "2.0.0" as const;

export type F061ReportTtsAudioSummaryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F061ReportTtsAudioSummaryConfig {
  readonly featureId: typeof F061_FEATURE_ID;
  readonly stage: typeof F061_STAGE;
  readonly operationCode: typeof F061_OPERATION_CODE;
  readonly contractVersion: typeof F061_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F061ReportTtsAudioSummaryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly estimated_seconds: string | number;
  readonly ssml_script: string | number | boolean | readonly string[];
  readonly voice_profile: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F061ReportTtsAudioSummaryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F061_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F061ReportTtsAudioSummaryOutput {
  readonly featureId: typeof F061_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F061ReportTtsAudioSummaryExecutionStatus;
  readonly operationCode: typeof F061_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_estimated_seconds: string | number;
  readonly resolved_ssml_script: string | number | boolean | readonly string[];
  readonly resolved_voice_profile: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F061ReportTtsAudioSummaryAuditEntry;
}

export interface F061ReportTtsAudioSummaryTelemetrySnapshot {
  readonly featureId: typeof F061_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F061_CONFIG: F061ReportTtsAudioSummaryConfig = {
  featureId: F061_FEATURE_ID,
  stage: F061_STAGE,
  operationCode: F061_OPERATION_CODE,
  contractVersion: F061_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F061ReportTtsAudioSummaryValidationError extends Error {
  public readonly featureId = F061_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F061 Validation Error on '${field}']: ${message}`);
    this.name = "F061ReportTtsAudioSummaryValidationError";
    this.field = field;
  }
}

export function computeF061Digest(rawPayload: string): string {
  return `f061_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F061ReportTtsAudioSummaryEngine {
  private readonly config: F061ReportTtsAudioSummaryConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F061ReportTtsAudioSummaryOutput[] = [];
  private readonly auditLog: F061ReportTtsAudioSummaryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F061ReportTtsAudioSummaryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F061ReportTtsAudioSummaryConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F061_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F061ReportTtsAudioSummaryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F061ReportTtsAudioSummaryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F061ReportTtsAudioSummaryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F061ReportTtsAudioSummaryValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      estimated_seconds: input.estimated_seconds,
      ssml_script: input.ssml_script,
      voice_profile: input.voice_profile
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F061ReportTtsAudioSummaryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F061ReportTtsAudioSummaryInput): F061ReportTtsAudioSummaryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F061_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        estimated_seconds: input.estimated_seconds,
        ssml_script: input.ssml_script,
        voice_profile: input.voice_profile
      });
      const payloadHash = computeF061Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F061ReportTtsAudioSummaryValidationError(
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
        featureId: F061_FEATURE_ID,
        operationCode: F061_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          estimated_seconds: input.estimated_seconds,
          ssml_script: input.ssml_script,
          voice_profile: input.voice_profile
        }
      });

      const executionId = `exec_f061_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f061_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F061ReportTtsAudioSummaryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F061_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tts_briefing_generator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F061ReportTtsAudioSummaryOutput = {
        featureId: F061_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F061_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_estimated_seconds: kernelResult.resolvedFields.estimated_seconds as string | number,
        resolved_ssml_script: kernelResult.resolvedFields.ssml_script as string | number | boolean | readonly string[],
        resolved_voice_profile: kernelResult.resolvedFields.voice_profile as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F061ReportTtsAudioSummaryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F061_FEATURE_ID,
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

  public getAuditTrail(): readonly F061ReportTtsAudioSummaryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F061ReportTtsAudioSummaryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF061Module(): {
  featureId: typeof F061_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F061ReportTtsAudioSummaryEngine();
  const sampleInput: F061ReportTtsAudioSummaryInput = {
    requestId: "req_verify_f061",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f061_artifact_id_seed",
    estimated_seconds: 42,
    ssml_script: true,
    voice_profile: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 61 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F061" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F061_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
