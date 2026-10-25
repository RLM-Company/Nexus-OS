/**
 * F041 (stage2-canvas): Частичная регенерация блока (In-place Selection Edit)
 * Переписывание агентом только выделенного абзаца или функции без пересборки всего файла
 * Operation Code: partial_block_edit
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F041_FEATURE_ID = "F041" as const;
export const F041_STAGE = "stage2-canvas" as const;
export const F041_OPERATION_CODE = "partial_block_edit" as const;
export const F041_CONTRACT_VERSION = "2.0.0" as const;

export type F041InplaceSelectionRegenerationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F041InplaceSelectionRegenerationConfig {
  readonly featureId: typeof F041_FEATURE_ID;
  readonly stage: typeof F041_STAGE;
  readonly operationCode: typeof F041_OPERATION_CODE;
  readonly contractVersion: typeof F041_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F041InplaceSelectionRegenerationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly start_line: string | number;
  readonly end_line: string | number | boolean | readonly string[];
  readonly patched_document: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F041InplaceSelectionRegenerationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F041_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F041InplaceSelectionRegenerationOutput {
  readonly featureId: typeof F041_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F041InplaceSelectionRegenerationExecutionStatus;
  readonly operationCode: typeof F041_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_start_line: string | number;
  readonly resolved_end_line: string | number | boolean | readonly string[];
  readonly resolved_patched_document: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F041InplaceSelectionRegenerationAuditEntry;
}

export interface F041InplaceSelectionRegenerationTelemetrySnapshot {
  readonly featureId: typeof F041_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F041_CONFIG: F041InplaceSelectionRegenerationConfig = {
  featureId: F041_FEATURE_ID,
  stage: F041_STAGE,
  operationCode: F041_OPERATION_CODE,
  contractVersion: F041_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F041InplaceSelectionRegenerationValidationError extends Error {
  public readonly featureId = F041_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F041 Validation Error on '${field}']: ${message}`);
    this.name = "F041InplaceSelectionRegenerationValidationError";
    this.field = field;
  }
}

export function computeF041Digest(rawPayload: string): string {
  return `f041_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F041InplaceSelectionRegenerationEngine {
  private readonly config: F041InplaceSelectionRegenerationConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F041InplaceSelectionRegenerationOutput[] = [];
  private readonly auditLog: F041InplaceSelectionRegenerationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F041InplaceSelectionRegenerationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F041InplaceSelectionRegenerationConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F041_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F041InplaceSelectionRegenerationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F041InplaceSelectionRegenerationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F041InplaceSelectionRegenerationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F041InplaceSelectionRegenerationValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      start_line: input.start_line,
      end_line: input.end_line,
      patched_document: input.patched_document
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F041InplaceSelectionRegenerationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F041InplaceSelectionRegenerationInput): F041InplaceSelectionRegenerationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F041_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        start_line: input.start_line,
        end_line: input.end_line,
        patched_document: input.patched_document
      });
      const payloadHash = computeF041Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F041InplaceSelectionRegenerationValidationError(
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
        featureId: F041_FEATURE_ID,
        operationCode: F041_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          start_line: input.start_line,
          end_line: input.end_line,
          patched_document: input.patched_document
        }
      });

      const executionId = `exec_f041_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f041_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F041InplaceSelectionRegenerationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F041_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `partial_block_edit:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F041InplaceSelectionRegenerationOutput = {
        featureId: F041_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F041_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_start_line: kernelResult.resolvedFields.start_line as string | number,
        resolved_end_line: kernelResult.resolvedFields.end_line as string | number | boolean | readonly string[],
        resolved_patched_document: kernelResult.resolvedFields.patched_document as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F041InplaceSelectionRegenerationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F041_FEATURE_ID,
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

  public getAuditTrail(): readonly F041InplaceSelectionRegenerationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F041InplaceSelectionRegenerationOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF041Module(): {
  featureId: typeof F041_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F041InplaceSelectionRegenerationEngine();
  const sampleInput: F041InplaceSelectionRegenerationInput = {
    requestId: "req_verify_f041",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f041_artifact_id_seed",
    start_line: 42,
    end_line: true,
    patched_document: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 41 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F041" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F041_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
