/**
 * F085 (stage3-skills-bus): Транскрибация аудио и записей созвонов
 * Перевод голосовых заметок и митингов в текст с выделением списка задач (Action Items)
 * Operation Code: meeting_action_extractor
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F085_FEATURE_ID = "F085" as const;
export const F085_STAGE = "stage3-skills-bus" as const;
export const F085_OPERATION_CODE = "meeting_action_extractor" as const;
export const F085_CONTRACT_VERSION = "2.0.0" as const;

export type F085AudioMeetingTranscriberExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F085AudioMeetingTranscriberConfig {
  readonly featureId: typeof F085_FEATURE_ID;
  readonly stage: typeof F085_STAGE;
  readonly operationCode: typeof F085_OPERATION_CODE;
  readonly contractVersion: typeof F085_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F085AudioMeetingTranscriberInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly recording_id: string;
  readonly transcript_length: string | number;
  readonly action_items: string | number | boolean | readonly string[];
  readonly assigned_owners: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F085AudioMeetingTranscriberAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F085_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F085AudioMeetingTranscriberOutput {
  readonly featureId: typeof F085_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F085AudioMeetingTranscriberExecutionStatus;
  readonly operationCode: typeof F085_OPERATION_CODE;
  readonly resolved_recording_id: string;
  readonly resolved_transcript_length: string | number;
  readonly resolved_action_items: string | number | boolean | readonly string[];
  readonly resolved_assigned_owners: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F085AudioMeetingTranscriberAuditEntry;
}

export interface F085AudioMeetingTranscriberTelemetrySnapshot {
  readonly featureId: typeof F085_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F085_CONFIG: F085AudioMeetingTranscriberConfig = {
  featureId: F085_FEATURE_ID,
  stage: F085_STAGE,
  operationCode: F085_OPERATION_CODE,
  contractVersion: F085_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F085AudioMeetingTranscriberValidationError extends Error {
  public readonly featureId = F085_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F085 Validation Error on '${field}']: ${message}`);
    this.name = "F085AudioMeetingTranscriberValidationError";
    this.field = field;
  }
}

export function computeF085Digest(rawPayload: string): string {
  return `f085_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F085AudioMeetingTranscriberEngine {
  private readonly config: F085AudioMeetingTranscriberConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F085AudioMeetingTranscriberOutput[] = [];
  private readonly auditLog: F085AudioMeetingTranscriberAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F085AudioMeetingTranscriberOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F085AudioMeetingTranscriberConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F085_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F085AudioMeetingTranscriberConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F085AudioMeetingTranscriberInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F085AudioMeetingTranscriberValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.recording_id).trim().length === 0) {
      throw new F085AudioMeetingTranscriberValidationError("recording_id", "Primary domain attribute 'recording_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      recording_id: input.recording_id,
      transcript_length: input.transcript_length,
      action_items: input.action_items,
      assigned_owners: input.assigned_owners
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F085AudioMeetingTranscriberValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F085AudioMeetingTranscriberInput): F085AudioMeetingTranscriberOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F085_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        recording_id: input.recording_id,
        transcript_length: input.transcript_length,
        action_items: input.action_items,
        assigned_owners: input.assigned_owners
      });
      const payloadHash = computeF085Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F085AudioMeetingTranscriberValidationError(
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
        featureId: F085_FEATURE_ID,
        operationCode: F085_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          recording_id: input.recording_id,
          transcript_length: input.transcript_length,
          action_items: input.action_items,
          assigned_owners: input.assigned_owners
        }
      });

      const executionId = `exec_f085_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f085_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F085AudioMeetingTranscriberAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F085_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `meeting_action_extractor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F085AudioMeetingTranscriberOutput = {
        featureId: F085_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F085_OPERATION_CODE,
        resolved_recording_id: kernelResult.resolvedFields.recording_id as string,
        resolved_transcript_length: kernelResult.resolvedFields.transcript_length as string | number,
        resolved_action_items: kernelResult.resolvedFields.action_items as string | number | boolean | readonly string[],
        resolved_assigned_owners: kernelResult.resolvedFields.assigned_owners as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F085AudioMeetingTranscriberTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F085_FEATURE_ID,
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

  public getAuditTrail(): readonly F085AudioMeetingTranscriberAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F085AudioMeetingTranscriberOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF085Module(): {
  featureId: typeof F085_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F085AudioMeetingTranscriberEngine();
  const sampleInput: F085AudioMeetingTranscriberInput = {
    requestId: "req_verify_f085",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    recording_id: "f085_recording_id_seed",
    transcript_length: 42,
    action_items: true,
    assigned_owners: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 85 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F085" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_recording_id !== sampleInput.recording_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F085_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
