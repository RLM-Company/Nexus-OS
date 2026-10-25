/**
 * F086 (stage3-skills-bus): Синхронизация с календарём и дедлайнами
 * Привязка этапов выполнения агентных задач к реальному расписанию проекта
 * Operation Code: calendar_milestone_sync
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F086_FEATURE_ID = "F086" as const;
export const F086_STAGE = "stage3-skills-bus" as const;
export const F086_OPERATION_CODE = "calendar_milestone_sync" as const;
export const F086_CONTRACT_VERSION = "2.0.0" as const;

export type F086CalendarDeadlineSynchronizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F086CalendarDeadlineSynchronizerConfig {
  readonly featureId: typeof F086_FEATURE_ID;
  readonly stage: typeof F086_STAGE;
  readonly operationCode: typeof F086_OPERATION_CODE;
  readonly contractVersion: typeof F086_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F086CalendarDeadlineSynchronizerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly project_id: string;
  readonly milestone_id: string | number;
  readonly deadline_iso: string | number | boolean | readonly string[];
  readonly schedule_aligned: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F086CalendarDeadlineSynchronizerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F086_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F086CalendarDeadlineSynchronizerOutput {
  readonly featureId: typeof F086_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F086CalendarDeadlineSynchronizerExecutionStatus;
  readonly operationCode: typeof F086_OPERATION_CODE;
  readonly resolved_project_id: string;
  readonly resolved_milestone_id: string | number;
  readonly resolved_deadline_iso: string | number | boolean | readonly string[];
  readonly resolved_schedule_aligned: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F086CalendarDeadlineSynchronizerAuditEntry;
}

export interface F086CalendarDeadlineSynchronizerTelemetrySnapshot {
  readonly featureId: typeof F086_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F086_CONFIG: F086CalendarDeadlineSynchronizerConfig = {
  featureId: F086_FEATURE_ID,
  stage: F086_STAGE,
  operationCode: F086_OPERATION_CODE,
  contractVersion: F086_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F086CalendarDeadlineSynchronizerValidationError extends Error {
  public readonly featureId = F086_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F086 Validation Error on '${field}']: ${message}`);
    this.name = "F086CalendarDeadlineSynchronizerValidationError";
    this.field = field;
  }
}

export function computeF086Digest(rawPayload: string): string {
  return `f086_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F086CalendarDeadlineSynchronizerEngine {
  private readonly config: F086CalendarDeadlineSynchronizerConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F086CalendarDeadlineSynchronizerOutput[] = [];
  private readonly auditLog: F086CalendarDeadlineSynchronizerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F086CalendarDeadlineSynchronizerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F086CalendarDeadlineSynchronizerConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F086_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F086CalendarDeadlineSynchronizerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F086CalendarDeadlineSynchronizerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F086CalendarDeadlineSynchronizerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.project_id).trim().length === 0) {
      throw new F086CalendarDeadlineSynchronizerValidationError("project_id", "Primary domain attribute 'project_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      project_id: input.project_id,
      milestone_id: input.milestone_id,
      deadline_iso: input.deadline_iso,
      schedule_aligned: input.schedule_aligned
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F086CalendarDeadlineSynchronizerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F086CalendarDeadlineSynchronizerInput): F086CalendarDeadlineSynchronizerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F086_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        project_id: input.project_id,
        milestone_id: input.milestone_id,
        deadline_iso: input.deadline_iso,
        schedule_aligned: input.schedule_aligned
      });
      const payloadHash = computeF086Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F086CalendarDeadlineSynchronizerValidationError(
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
        featureId: F086_FEATURE_ID,
        operationCode: F086_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          project_id: input.project_id,
          milestone_id: input.milestone_id,
          deadline_iso: input.deadline_iso,
          schedule_aligned: input.schedule_aligned
        }
      });

      const executionId = `exec_f086_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f086_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F086CalendarDeadlineSynchronizerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F086_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `calendar_milestone_sync:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F086CalendarDeadlineSynchronizerOutput = {
        featureId: F086_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F086_OPERATION_CODE,
        resolved_project_id: kernelResult.resolvedFields.project_id as string,
        resolved_milestone_id: kernelResult.resolvedFields.milestone_id as string | number,
        resolved_deadline_iso: kernelResult.resolvedFields.deadline_iso as string | number | boolean | readonly string[],
        resolved_schedule_aligned: kernelResult.resolvedFields.schedule_aligned as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F086CalendarDeadlineSynchronizerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F086_FEATURE_ID,
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

  public getAuditTrail(): readonly F086CalendarDeadlineSynchronizerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F086CalendarDeadlineSynchronizerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF086Module(): {
  featureId: typeof F086_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F086CalendarDeadlineSynchronizerEngine();
  const sampleInput: F086CalendarDeadlineSynchronizerInput = {
    requestId: "req_verify_f086",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    project_id: "f086_project_id_seed",
    milestone_id: 42,
    deadline_iso: true,
    schedule_aligned: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 86 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F086" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_project_id !== sampleInput.project_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F086_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
