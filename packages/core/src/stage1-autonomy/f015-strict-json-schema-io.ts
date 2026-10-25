/**
 * F015 (stage1-autonomy): Контракты ввода-вывода (Strict JSON Schema IO)
 * Валидация типизированных ответов между агентами через схемы данных
 * Operation Code: schema_validator
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F015_FEATURE_ID = "F015" as const;
export const F015_STAGE = "stage1-autonomy" as const;
export const F015_OPERATION_CODE = "schema_validator" as const;
export const F015_CONTRACT_VERSION = "2.0.0" as const;

export type F015StrictJsonSchemaIoExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F015StrictJsonSchemaIoConfig {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly stage: typeof F015_STAGE;
  readonly operationCode: typeof F015_OPERATION_CODE;
  readonly contractVersion: typeof F015_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F015StrictJsonSchemaIoInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly schema_id: string;
  readonly payload_valid: string | number;
  readonly validated_fields_count: string | number | boolean | readonly string[];
  readonly violation_errors: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F015StrictJsonSchemaIoAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F015_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F015StrictJsonSchemaIoOutput {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F015StrictJsonSchemaIoExecutionStatus;
  readonly operationCode: typeof F015_OPERATION_CODE;
  readonly resolved_schema_id: string;
  readonly resolved_payload_valid: string | number;
  readonly resolved_validated_fields_count: string | number | boolean | readonly string[];
  readonly resolved_violation_errors: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F015StrictJsonSchemaIoAuditEntry;
}

export interface F015StrictJsonSchemaIoTelemetrySnapshot {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F015_CONFIG: F015StrictJsonSchemaIoConfig = {
  featureId: F015_FEATURE_ID,
  stage: F015_STAGE,
  operationCode: F015_OPERATION_CODE,
  contractVersion: F015_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F015StrictJsonSchemaIoValidationError extends Error {
  public readonly featureId = F015_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F015 Validation Error on '${field}']: ${message}`);
    this.name = "F015StrictJsonSchemaIoValidationError";
    this.field = field;
  }
}

export function computeF015Digest(rawPayload: string): string {
  return `f015_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F015StrictJsonSchemaIoEngine {
  private readonly config: F015StrictJsonSchemaIoConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F015StrictJsonSchemaIoOutput[] = [];
  private readonly auditLog: F015StrictJsonSchemaIoAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F015StrictJsonSchemaIoOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F015StrictJsonSchemaIoConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F015_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F015StrictJsonSchemaIoConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F015StrictJsonSchemaIoInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F015StrictJsonSchemaIoValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.schema_id).trim().length === 0) {
      throw new F015StrictJsonSchemaIoValidationError("schema_id", "Primary domain attribute 'schema_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      schema_id: input.schema_id,
      payload_valid: input.payload_valid,
      validated_fields_count: input.validated_fields_count,
      violation_errors: input.violation_errors
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F015StrictJsonSchemaIoValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F015StrictJsonSchemaIoInput): F015StrictJsonSchemaIoOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F015_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        schema_id: input.schema_id,
        payload_valid: input.payload_valid,
        validated_fields_count: input.validated_fields_count,
        violation_errors: input.violation_errors
      });
      const payloadHash = computeF015Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F015StrictJsonSchemaIoValidationError(
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
        featureId: F015_FEATURE_ID,
        operationCode: F015_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          schema_id: input.schema_id,
          payload_valid: input.payload_valid,
          validated_fields_count: input.validated_fields_count,
          violation_errors: input.violation_errors
        }
      });

      const executionId = `exec_f015_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f015_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F015StrictJsonSchemaIoAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F015_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `schema_validator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F015StrictJsonSchemaIoOutput = {
        featureId: F015_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F015_OPERATION_CODE,
        resolved_schema_id: kernelResult.resolvedFields.schema_id as string,
        resolved_payload_valid: kernelResult.resolvedFields.payload_valid as string | number,
        resolved_validated_fields_count: kernelResult.resolvedFields.validated_fields_count as string | number | boolean | readonly string[],
        resolved_violation_errors: kernelResult.resolvedFields.violation_errors as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F015StrictJsonSchemaIoTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F015_FEATURE_ID,
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

  public getAuditTrail(): readonly F015StrictJsonSchemaIoAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F015StrictJsonSchemaIoOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF015Module(): {
  featureId: typeof F015_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F015StrictJsonSchemaIoEngine();
  const sampleInput: F015StrictJsonSchemaIoInput = {
    requestId: "req_verify_f015",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    schema_id: "f015_schema_id_seed",
    payload_valid: 42,
    validated_fields_count: true,
    violation_errors: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 15 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F015" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_schema_id !== sampleInput.schema_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F015_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
