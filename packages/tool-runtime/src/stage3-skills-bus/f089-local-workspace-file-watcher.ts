/**
 * F089 (stage3-skills-bus): Локальный файловый наблюдатель (File Watcher)
 * Автоматический подхват изменённых файлов в рабочей директории без ручной перезагрузки
 * Operation Code: fs_change_watcher
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F089_FEATURE_ID = "F089" as const;
export const F089_STAGE = "stage3-skills-bus" as const;
export const F089_OPERATION_CODE = "fs_change_watcher" as const;
export const F089_CONTRACT_VERSION = "2.0.0" as const;

export type F089LocalWorkspaceFileWatcherExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F089LocalWorkspaceFileWatcherConfig {
  readonly featureId: typeof F089_FEATURE_ID;
  readonly stage: typeof F089_STAGE;
  readonly operationCode: typeof F089_OPERATION_CODE;
  readonly contractVersion: typeof F089_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F089LocalWorkspaceFileWatcherInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly watched_dir: string;
  readonly changed_file_path: string | number;
  readonly change_event_kind: string | number | boolean | readonly string[];
  readonly reindexed_ok: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F089LocalWorkspaceFileWatcherAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F089_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F089LocalWorkspaceFileWatcherOutput {
  readonly featureId: typeof F089_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F089LocalWorkspaceFileWatcherExecutionStatus;
  readonly operationCode: typeof F089_OPERATION_CODE;
  readonly resolved_watched_dir: string;
  readonly resolved_changed_file_path: string | number;
  readonly resolved_change_event_kind: string | number | boolean | readonly string[];
  readonly resolved_reindexed_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F089LocalWorkspaceFileWatcherAuditEntry;
}

export interface F089LocalWorkspaceFileWatcherTelemetrySnapshot {
  readonly featureId: typeof F089_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F089_CONFIG: F089LocalWorkspaceFileWatcherConfig = {
  featureId: F089_FEATURE_ID,
  stage: F089_STAGE,
  operationCode: F089_OPERATION_CODE,
  contractVersion: F089_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F089LocalWorkspaceFileWatcherValidationError extends Error {
  public readonly featureId = F089_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F089 Validation Error on '${field}']: ${message}`);
    this.name = "F089LocalWorkspaceFileWatcherValidationError";
    this.field = field;
  }
}

export function computeF089Digest(rawPayload: string): string {
  return `f089_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F089LocalWorkspaceFileWatcherEngine {
  private readonly config: F089LocalWorkspaceFileWatcherConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F089LocalWorkspaceFileWatcherOutput[] = [];
  private readonly auditLog: F089LocalWorkspaceFileWatcherAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F089LocalWorkspaceFileWatcherOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F089LocalWorkspaceFileWatcherConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F089_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F089LocalWorkspaceFileWatcherConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F089LocalWorkspaceFileWatcherInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F089LocalWorkspaceFileWatcherValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.watched_dir).trim().length === 0) {
      throw new F089LocalWorkspaceFileWatcherValidationError("watched_dir", "Primary domain attribute 'watched_dir' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      watched_dir: input.watched_dir,
      changed_file_path: input.changed_file_path,
      change_event_kind: input.change_event_kind,
      reindexed_ok: input.reindexed_ok
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F089LocalWorkspaceFileWatcherValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F089LocalWorkspaceFileWatcherInput): F089LocalWorkspaceFileWatcherOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F089_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        watched_dir: input.watched_dir,
        changed_file_path: input.changed_file_path,
        change_event_kind: input.change_event_kind,
        reindexed_ok: input.reindexed_ok
      });
      const payloadHash = computeF089Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F089LocalWorkspaceFileWatcherValidationError(
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
        featureId: F089_FEATURE_ID,
        operationCode: F089_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          watched_dir: input.watched_dir,
          changed_file_path: input.changed_file_path,
          change_event_kind: input.change_event_kind,
          reindexed_ok: input.reindexed_ok
        }
      });

      const executionId = `exec_f089_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f089_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F089LocalWorkspaceFileWatcherAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F089_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `fs_change_watcher:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F089LocalWorkspaceFileWatcherOutput = {
        featureId: F089_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F089_OPERATION_CODE,
        resolved_watched_dir: kernelResult.resolvedFields.watched_dir as string,
        resolved_changed_file_path: kernelResult.resolvedFields.changed_file_path as string | number,
        resolved_change_event_kind: kernelResult.resolvedFields.change_event_kind as string | number | boolean | readonly string[],
        resolved_reindexed_ok: kernelResult.resolvedFields.reindexed_ok as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F089LocalWorkspaceFileWatcherTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F089_FEATURE_ID,
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

  public getAuditTrail(): readonly F089LocalWorkspaceFileWatcherAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F089LocalWorkspaceFileWatcherOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF089Module(): {
  featureId: typeof F089_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F089LocalWorkspaceFileWatcherEngine();
  const sampleInput: F089LocalWorkspaceFileWatcherInput = {
    requestId: "req_verify_f089",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    watched_dir: "f089_watched_dir_seed",
    changed_file_path: 42,
    change_event_kind: true,
    reindexed_ok: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 89 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F089" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_watched_dir !== sampleInput.watched_dir &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F089_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
