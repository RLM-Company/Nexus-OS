/**
 * F054 (stage2-canvas): Блокировка секций от перезаписи (Section Locking)
 * Заморозка утверждённых абзацев, чтобы агент не менял их при глобальном рефакторинге
 * Operation Code: section_lock_guard
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F054_FEATURE_ID = "F054" as const;
export const F054_STAGE = "stage2-canvas" as const;
export const F054_OPERATION_CODE = "section_lock_guard" as const;
export const F054_CONTRACT_VERSION = "2.0.0" as const;

export type F054SectionOverwriteLockingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F054SectionOverwriteLockingConfig {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly stage: typeof F054_STAGE;
  readonly operationCode: typeof F054_OPERATION_CODE;
  readonly contractVersion: typeof F054_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F054SectionOverwriteLockingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly locked_section_ids: string | number;
  readonly write_attempt_blocked: string | number | boolean | readonly string[];
  readonly owner_lock_token: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F054SectionOverwriteLockingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F054_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F054SectionOverwriteLockingOutput {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F054SectionOverwriteLockingExecutionStatus;
  readonly operationCode: typeof F054_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_locked_section_ids: string | number;
  readonly resolved_write_attempt_blocked: string | number | boolean | readonly string[];
  readonly resolved_owner_lock_token: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F054SectionOverwriteLockingAuditEntry;
}

export interface F054SectionOverwriteLockingTelemetrySnapshot {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F054_CONFIG: F054SectionOverwriteLockingConfig = {
  featureId: F054_FEATURE_ID,
  stage: F054_STAGE,
  operationCode: F054_OPERATION_CODE,
  contractVersion: F054_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F054SectionOverwriteLockingValidationError extends Error {
  public readonly featureId = F054_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F054 Validation Error on '${field}']: ${message}`);
    this.name = "F054SectionOverwriteLockingValidationError";
    this.field = field;
  }
}

export function computeF054Digest(rawPayload: string): string {
  return `f054_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F054SectionOverwriteLockingEngine {
  private readonly config: F054SectionOverwriteLockingConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F054SectionOverwriteLockingOutput[] = [];
  private readonly auditLog: F054SectionOverwriteLockingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F054SectionOverwriteLockingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F054SectionOverwriteLockingConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F054_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F054SectionOverwriteLockingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F054SectionOverwriteLockingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F054SectionOverwriteLockingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F054SectionOverwriteLockingValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      locked_section_ids: input.locked_section_ids,
      write_attempt_blocked: input.write_attempt_blocked,
      owner_lock_token: input.owner_lock_token
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F054SectionOverwriteLockingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F054SectionOverwriteLockingInput): F054SectionOverwriteLockingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F054_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        locked_section_ids: input.locked_section_ids,
        write_attempt_blocked: input.write_attempt_blocked,
        owner_lock_token: input.owner_lock_token
      });
      const payloadHash = computeF054Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F054SectionOverwriteLockingValidationError(
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
        featureId: F054_FEATURE_ID,
        operationCode: F054_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          locked_section_ids: input.locked_section_ids,
          write_attempt_blocked: input.write_attempt_blocked,
          owner_lock_token: input.owner_lock_token
        }
      });

      const executionId = `exec_f054_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f054_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F054SectionOverwriteLockingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F054_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `section_lock_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F054SectionOverwriteLockingOutput = {
        featureId: F054_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F054_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_locked_section_ids: kernelResult.resolvedFields.locked_section_ids as string | number,
        resolved_write_attempt_blocked: kernelResult.resolvedFields.write_attempt_blocked as string | number | boolean | readonly string[],
        resolved_owner_lock_token: kernelResult.resolvedFields.owner_lock_token as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F054SectionOverwriteLockingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F054_FEATURE_ID,
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

  public getAuditTrail(): readonly F054SectionOverwriteLockingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F054SectionOverwriteLockingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF054Module(): {
  featureId: typeof F054_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F054SectionOverwriteLockingEngine();
  const sampleInput: F054SectionOverwriteLockingInput = {
    requestId: "req_verify_f054",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f054_artifact_id_seed",
    locked_section_ids: 42,
    write_attempt_blocked: true,
    owner_lock_token: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 54 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F054" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F054_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
