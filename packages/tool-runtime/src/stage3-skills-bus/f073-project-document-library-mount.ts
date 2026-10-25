/**
 * F073 (stage3-skills-bus): Интеграция с библиотекой документов проекта
 * Прямое монтирование папок хранилища в зону видимости агентов
 * Operation Code: storage_folder_mounter
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F073_FEATURE_ID = "F073" as const;
export const F073_STAGE = "stage3-skills-bus" as const;
export const F073_OPERATION_CODE = "storage_folder_mounter" as const;
export const F073_CONTRACT_VERSION = "2.0.0" as const;

export type F073ProjectDocumentLibraryMountExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F073ProjectDocumentLibraryMountConfig {
  readonly featureId: typeof F073_FEATURE_ID;
  readonly stage: typeof F073_STAGE;
  readonly operationCode: typeof F073_OPERATION_CODE;
  readonly contractVersion: typeof F073_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F073ProjectDocumentLibraryMountInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly mount_id: string;
  readonly folder_path: string | number;
  readonly indexed_files_count: string | number | boolean | readonly string[];
  readonly read_only_guard: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F073ProjectDocumentLibraryMountAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F073_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F073ProjectDocumentLibraryMountOutput {
  readonly featureId: typeof F073_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F073ProjectDocumentLibraryMountExecutionStatus;
  readonly operationCode: typeof F073_OPERATION_CODE;
  readonly resolved_mount_id: string;
  readonly resolved_folder_path: string | number;
  readonly resolved_indexed_files_count: string | number | boolean | readonly string[];
  readonly resolved_read_only_guard: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F073ProjectDocumentLibraryMountAuditEntry;
}

export interface F073ProjectDocumentLibraryMountTelemetrySnapshot {
  readonly featureId: typeof F073_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F073_CONFIG: F073ProjectDocumentLibraryMountConfig = {
  featureId: F073_FEATURE_ID,
  stage: F073_STAGE,
  operationCode: F073_OPERATION_CODE,
  contractVersion: F073_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F073ProjectDocumentLibraryMountValidationError extends Error {
  public readonly featureId = F073_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F073 Validation Error on '${field}']: ${message}`);
    this.name = "F073ProjectDocumentLibraryMountValidationError";
    this.field = field;
  }
}

export function computeF073Digest(rawPayload: string): string {
  return `f073_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F073ProjectDocumentLibraryMountEngine {
  private readonly config: F073ProjectDocumentLibraryMountConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F073ProjectDocumentLibraryMountOutput[] = [];
  private readonly auditLog: F073ProjectDocumentLibraryMountAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F073ProjectDocumentLibraryMountOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F073ProjectDocumentLibraryMountConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F073_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F073ProjectDocumentLibraryMountConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F073ProjectDocumentLibraryMountInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F073ProjectDocumentLibraryMountValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.mount_id).trim().length === 0) {
      throw new F073ProjectDocumentLibraryMountValidationError("mount_id", "Primary domain attribute 'mount_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      mount_id: input.mount_id,
      folder_path: input.folder_path,
      indexed_files_count: input.indexed_files_count,
      read_only_guard: input.read_only_guard
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F073ProjectDocumentLibraryMountValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F073ProjectDocumentLibraryMountInput): F073ProjectDocumentLibraryMountOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F073_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        mount_id: input.mount_id,
        folder_path: input.folder_path,
        indexed_files_count: input.indexed_files_count,
        read_only_guard: input.read_only_guard
      });
      const payloadHash = computeF073Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F073ProjectDocumentLibraryMountValidationError(
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
        featureId: F073_FEATURE_ID,
        operationCode: F073_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          mount_id: input.mount_id,
          folder_path: input.folder_path,
          indexed_files_count: input.indexed_files_count,
          read_only_guard: input.read_only_guard
        }
      });

      const executionId = `exec_f073_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f073_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F073ProjectDocumentLibraryMountAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F073_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `storage_folder_mounter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F073ProjectDocumentLibraryMountOutput = {
        featureId: F073_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F073_OPERATION_CODE,
        resolved_mount_id: kernelResult.resolvedFields.mount_id as string,
        resolved_folder_path: kernelResult.resolvedFields.folder_path as string | number,
        resolved_indexed_files_count: kernelResult.resolvedFields.indexed_files_count as string | number | boolean | readonly string[],
        resolved_read_only_guard: kernelResult.resolvedFields.read_only_guard as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F073ProjectDocumentLibraryMountTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F073_FEATURE_ID,
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

  public getAuditTrail(): readonly F073ProjectDocumentLibraryMountAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F073ProjectDocumentLibraryMountOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF073Module(): {
  featureId: typeof F073_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F073ProjectDocumentLibraryMountEngine();
  const sampleInput: F073ProjectDocumentLibraryMountInput = {
    requestId: "req_verify_f073",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    mount_id: "f073_mount_id_seed",
    folder_path: 42,
    indexed_files_count: true,
    read_only_guard: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 73 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F073" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_mount_id !== sampleInput.mount_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F073_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
