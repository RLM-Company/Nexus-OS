/**
 * F084 (stage3-skills-bus): Пакетная обработка файлов (Batch File Processor)
 * Применение одного скилла сразу к 10–50 загруженным документам с агрегацией в таблицу
 * Operation Code: batch_doc_processor
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F084_FEATURE_ID = "F084" as const;
export const F084_STAGE = "stage3-skills-bus" as const;
export const F084_OPERATION_CODE = "batch_doc_processor" as const;
export const F084_CONTRACT_VERSION = "2.0.0" as const;

export type F084BatchFileSkillProcessorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F084BatchFileSkillProcessorConfig {
  readonly featureId: typeof F084_FEATURE_ID;
  readonly stage: typeof F084_STAGE;
  readonly operationCode: typeof F084_OPERATION_CODE;
  readonly contractVersion: typeof F084_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F084BatchFileSkillProcessorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly batch_id: string;
  readonly processed_files_count: string | number;
  readonly skill_handle: string | number | boolean | readonly string[];
  readonly aggregated_rows: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F084BatchFileSkillProcessorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F084_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F084BatchFileSkillProcessorOutput {
  readonly featureId: typeof F084_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F084BatchFileSkillProcessorExecutionStatus;
  readonly operationCode: typeof F084_OPERATION_CODE;
  readonly resolved_batch_id: string;
  readonly resolved_processed_files_count: string | number;
  readonly resolved_skill_handle: string | number | boolean | readonly string[];
  readonly resolved_aggregated_rows: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F084BatchFileSkillProcessorAuditEntry;
}

export interface F084BatchFileSkillProcessorTelemetrySnapshot {
  readonly featureId: typeof F084_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F084_CONFIG: F084BatchFileSkillProcessorConfig = {
  featureId: F084_FEATURE_ID,
  stage: F084_STAGE,
  operationCode: F084_OPERATION_CODE,
  contractVersion: F084_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F084BatchFileSkillProcessorValidationError extends Error {
  public readonly featureId = F084_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F084 Validation Error on '${field}']: ${message}`);
    this.name = "F084BatchFileSkillProcessorValidationError";
    this.field = field;
  }
}

export function computeF084Digest(rawPayload: string): string {
  return `f084_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F084BatchFileSkillProcessorEngine {
  private readonly config: F084BatchFileSkillProcessorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F084BatchFileSkillProcessorOutput[] = [];
  private readonly auditLog: F084BatchFileSkillProcessorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F084BatchFileSkillProcessorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F084BatchFileSkillProcessorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F084_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F084BatchFileSkillProcessorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F084BatchFileSkillProcessorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F084BatchFileSkillProcessorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.batch_id).trim().length === 0) {
      throw new F084BatchFileSkillProcessorValidationError("batch_id", "Primary domain attribute 'batch_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      batch_id: input.batch_id,
      processed_files_count: input.processed_files_count,
      skill_handle: input.skill_handle,
      aggregated_rows: input.aggregated_rows
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F084BatchFileSkillProcessorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F084BatchFileSkillProcessorInput): F084BatchFileSkillProcessorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F084_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        batch_id: input.batch_id,
        processed_files_count: input.processed_files_count,
        skill_handle: input.skill_handle,
        aggregated_rows: input.aggregated_rows
      });
      const payloadHash = computeF084Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F084BatchFileSkillProcessorValidationError(
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
        featureId: F084_FEATURE_ID,
        operationCode: F084_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          batch_id: input.batch_id,
          processed_files_count: input.processed_files_count,
          skill_handle: input.skill_handle,
          aggregated_rows: input.aggregated_rows
        }
      });

      const executionId = `exec_f084_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f084_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F084BatchFileSkillProcessorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F084_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `batch_doc_processor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F084BatchFileSkillProcessorOutput = {
        featureId: F084_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F084_OPERATION_CODE,
        resolved_batch_id: kernelResult.resolvedFields.batch_id as string,
        resolved_processed_files_count: kernelResult.resolvedFields.processed_files_count as string | number,
        resolved_skill_handle: kernelResult.resolvedFields.skill_handle as string | number | boolean | readonly string[],
        resolved_aggregated_rows: kernelResult.resolvedFields.aggregated_rows as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F084BatchFileSkillProcessorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F084_FEATURE_ID,
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

  public getAuditTrail(): readonly F084BatchFileSkillProcessorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F084BatchFileSkillProcessorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF084Module(): {
  featureId: typeof F084_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F084BatchFileSkillProcessorEngine();
  const sampleInput: F084BatchFileSkillProcessorInput = {
    requestId: "req_verify_f084",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    batch_id: "f084_batch_id_seed",
    processed_files_count: 42,
    skill_handle: true,
    aggregated_rows: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 84 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F084" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_batch_id !== sampleInput.batch_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F084_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
