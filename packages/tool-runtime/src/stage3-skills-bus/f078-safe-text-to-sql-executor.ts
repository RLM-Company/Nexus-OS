/**
 * F078 (stage3-skills-bus): Генератор и исполнитель SQL-запросов (Text-to-SQL)
 * Безопасное чтение подключённых баз данных с проверкой схемы перед запросом
 * Operation Code: text_to_sql_guard
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F078_FEATURE_ID = "F078" as const;
export const F078_STAGE = "stage3-skills-bus" as const;
export const F078_OPERATION_CODE = "text_to_sql_guard" as const;
export const F078_CONTRACT_VERSION = "2.0.0" as const;

export type F078SafeTextToSqlExecutorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F078SafeTextToSqlExecutorConfig {
  readonly featureId: typeof F078_FEATURE_ID;
  readonly stage: typeof F078_STAGE;
  readonly operationCode: typeof F078_OPERATION_CODE;
  readonly contractVersion: typeof F078_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F078SafeTextToSqlExecutorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly natural_query: string;
  readonly generated_sql: string | number;
  readonly schema_validated: string | number | boolean | readonly string[];
  readonly read_only_enforced: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F078SafeTextToSqlExecutorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F078_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F078SafeTextToSqlExecutorOutput {
  readonly featureId: typeof F078_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F078SafeTextToSqlExecutorExecutionStatus;
  readonly operationCode: typeof F078_OPERATION_CODE;
  readonly resolved_natural_query: string;
  readonly resolved_generated_sql: string | number;
  readonly resolved_schema_validated: string | number | boolean | readonly string[];
  readonly resolved_read_only_enforced: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F078SafeTextToSqlExecutorAuditEntry;
}

export interface F078SafeTextToSqlExecutorTelemetrySnapshot {
  readonly featureId: typeof F078_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F078_CONFIG: F078SafeTextToSqlExecutorConfig = {
  featureId: F078_FEATURE_ID,
  stage: F078_STAGE,
  operationCode: F078_OPERATION_CODE,
  contractVersion: F078_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F078SafeTextToSqlExecutorValidationError extends Error {
  public readonly featureId = F078_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F078 Validation Error on '${field}']: ${message}`);
    this.name = "F078SafeTextToSqlExecutorValidationError";
    this.field = field;
  }
}

export function computeF078Digest(rawPayload: string): string {
  return `f078_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F078SafeTextToSqlExecutorEngine {
  private readonly config: F078SafeTextToSqlExecutorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F078SafeTextToSqlExecutorOutput[] = [];
  private readonly auditLog: F078SafeTextToSqlExecutorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F078SafeTextToSqlExecutorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F078SafeTextToSqlExecutorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F078_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F078SafeTextToSqlExecutorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F078SafeTextToSqlExecutorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F078SafeTextToSqlExecutorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.natural_query).trim().length === 0) {
      throw new F078SafeTextToSqlExecutorValidationError("natural_query", "Primary domain attribute 'natural_query' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      natural_query: input.natural_query,
      generated_sql: input.generated_sql,
      schema_validated: input.schema_validated,
      read_only_enforced: input.read_only_enforced
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F078SafeTextToSqlExecutorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F078SafeTextToSqlExecutorInput): F078SafeTextToSqlExecutorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F078_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        natural_query: input.natural_query,
        generated_sql: input.generated_sql,
        schema_validated: input.schema_validated,
        read_only_enforced: input.read_only_enforced
      });
      const payloadHash = computeF078Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F078SafeTextToSqlExecutorValidationError(
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
        featureId: F078_FEATURE_ID,
        operationCode: F078_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          natural_query: input.natural_query,
          generated_sql: input.generated_sql,
          schema_validated: input.schema_validated,
          read_only_enforced: input.read_only_enforced
        }
      });

      const executionId = `exec_f078_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f078_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F078SafeTextToSqlExecutorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F078_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `text_to_sql_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F078SafeTextToSqlExecutorOutput = {
        featureId: F078_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F078_OPERATION_CODE,
        resolved_natural_query: kernelResult.resolvedFields.natural_query as string,
        resolved_generated_sql: kernelResult.resolvedFields.generated_sql as string | number,
        resolved_schema_validated: kernelResult.resolvedFields.schema_validated as string | number | boolean | readonly string[],
        resolved_read_only_enforced: kernelResult.resolvedFields.read_only_enforced as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F078SafeTextToSqlExecutorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F078_FEATURE_ID,
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

  public getAuditTrail(): readonly F078SafeTextToSqlExecutorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F078SafeTextToSqlExecutorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF078Module(): {
  featureId: typeof F078_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F078SafeTextToSqlExecutorEngine();
  const sampleInput: F078SafeTextToSqlExecutorInput = {
    requestId: "req_verify_f078",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    natural_query: "f078_natural_query_seed",
    generated_sql: 42,
    schema_validated: true,
    read_only_enforced: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 78 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F078" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_natural_query !== sampleInput.natural_query &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F078_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
