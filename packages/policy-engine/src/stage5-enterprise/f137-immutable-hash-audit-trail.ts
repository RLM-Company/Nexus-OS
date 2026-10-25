/**
 * F137 (stage5-enterprise): Неизменяемый лог безопасности (Immutable Audit Trail)
 * Запись всех входов, вызовов инструментов, экспорта данных и изменений прав
 * Operation Code: hash_chained_audit_ledger
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F137_FEATURE_ID = "F137" as const;
export const F137_STAGE = "stage5-enterprise" as const;
export const F137_OPERATION_CODE = "hash_chained_audit_ledger" as const;
export const F137_CONTRACT_VERSION = "2.0.0" as const;

export type F137ImmutableHashAuditTrailExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F137ImmutableHashAuditTrailConfig {
  readonly featureId: typeof F137_FEATURE_ID;
  readonly stage: typeof F137_STAGE;
  readonly operationCode: typeof F137_OPERATION_CODE;
  readonly contractVersion: typeof F137_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F137ImmutableHashAuditTrailInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly sequence_number: string;
  readonly previous_entry_hash: string | number;
  readonly current_entry_hash: string | number | boolean | readonly string[];
  readonly chain_tamper_free: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F137ImmutableHashAuditTrailAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F137_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F137ImmutableHashAuditTrailOutput {
  readonly featureId: typeof F137_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F137ImmutableHashAuditTrailExecutionStatus;
  readonly operationCode: typeof F137_OPERATION_CODE;
  readonly resolved_sequence_number: string;
  readonly resolved_previous_entry_hash: string | number;
  readonly resolved_current_entry_hash: string | number | boolean | readonly string[];
  readonly resolved_chain_tamper_free: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F137ImmutableHashAuditTrailAuditEntry;
}

export interface F137ImmutableHashAuditTrailTelemetrySnapshot {
  readonly featureId: typeof F137_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F137_CONFIG: F137ImmutableHashAuditTrailConfig = {
  featureId: F137_FEATURE_ID,
  stage: F137_STAGE,
  operationCode: F137_OPERATION_CODE,
  contractVersion: F137_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F137ImmutableHashAuditTrailValidationError extends Error {
  public readonly featureId = F137_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F137 Validation Error on '${field}']: ${message}`);
    this.name = "F137ImmutableHashAuditTrailValidationError";
    this.field = field;
  }
}

export function computeF137Digest(rawPayload: string): string {
  return `f137_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F137ImmutableHashAuditTrailEngine {
  private readonly config: F137ImmutableHashAuditTrailConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F137ImmutableHashAuditTrailOutput[] = [];
  private readonly auditLog: F137ImmutableHashAuditTrailAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F137ImmutableHashAuditTrailOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F137ImmutableHashAuditTrailConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F137_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F137ImmutableHashAuditTrailConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F137ImmutableHashAuditTrailInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F137ImmutableHashAuditTrailValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.sequence_number).trim().length === 0) {
      throw new F137ImmutableHashAuditTrailValidationError("sequence_number", "Primary domain attribute 'sequence_number' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      sequence_number: input.sequence_number,
      previous_entry_hash: input.previous_entry_hash,
      current_entry_hash: input.current_entry_hash,
      chain_tamper_free: input.chain_tamper_free
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F137ImmutableHashAuditTrailValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F137ImmutableHashAuditTrailInput): F137ImmutableHashAuditTrailOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F137_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        sequence_number: input.sequence_number,
        previous_entry_hash: input.previous_entry_hash,
        current_entry_hash: input.current_entry_hash,
        chain_tamper_free: input.chain_tamper_free
      });
      const payloadHash = computeF137Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F137ImmutableHashAuditTrailValidationError(
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
        featureId: F137_FEATURE_ID,
        operationCode: F137_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          sequence_number: input.sequence_number,
          previous_entry_hash: input.previous_entry_hash,
          current_entry_hash: input.current_entry_hash,
          chain_tamper_free: input.chain_tamper_free
        }
      });

      const executionId = `exec_f137_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f137_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F137ImmutableHashAuditTrailAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F137_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `hash_chained_audit_ledger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F137ImmutableHashAuditTrailOutput = {
        featureId: F137_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F137_OPERATION_CODE,
        resolved_sequence_number: kernelResult.resolvedFields.sequence_number as string,
        resolved_previous_entry_hash: kernelResult.resolvedFields.previous_entry_hash as string | number,
        resolved_current_entry_hash: kernelResult.resolvedFields.current_entry_hash as string | number | boolean | readonly string[],
        resolved_chain_tamper_free: kernelResult.resolvedFields.chain_tamper_free as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F137ImmutableHashAuditTrailTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F137_FEATURE_ID,
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

  public getAuditTrail(): readonly F137ImmutableHashAuditTrailAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F137ImmutableHashAuditTrailOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF137Module(): {
  featureId: typeof F137_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F137ImmutableHashAuditTrailEngine();
  const sampleInput: F137ImmutableHashAuditTrailInput = {
    requestId: "req_verify_f137",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    sequence_number: "f137_sequence_number_seed",
    previous_entry_hash: 42,
    current_entry_hash: true,
    chain_tamper_free: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 137 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F137" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_sequence_number !== sampleInput.sequence_number &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F137_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
