/**
 * F094 (stage3-skills-bus): Сравнение нескольких документов (Multi-Doc Diff & Matrix)
 * Составление сравнительной матрицы по 5–10 договорам или спецификациям
 * Operation Code: multidoc_matrix_builder
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F094_FEATURE_ID = "F094" as const;
export const F094_STAGE = "stage3-skills-bus" as const;
export const F094_OPERATION_CODE = "multidoc_matrix_builder" as const;
export const F094_CONTRACT_VERSION = "2.0.0" as const;

export type F094MultidocComparisonMatrixExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F094MultidocComparisonMatrixConfig {
  readonly featureId: typeof F094_FEATURE_ID;
  readonly stage: typeof F094_STAGE;
  readonly operationCode: typeof F094_OPERATION_CODE;
  readonly contractVersion: typeof F094_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F094MultidocComparisonMatrixInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly matrix_id: string;
  readonly compared_docs_count: string | number;
  readonly criteria_columns: string | number | boolean | readonly string[];
  readonly discrepancies_found: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F094MultidocComparisonMatrixAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F094_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F094MultidocComparisonMatrixOutput {
  readonly featureId: typeof F094_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F094MultidocComparisonMatrixExecutionStatus;
  readonly operationCode: typeof F094_OPERATION_CODE;
  readonly resolved_matrix_id: string;
  readonly resolved_compared_docs_count: string | number;
  readonly resolved_criteria_columns: string | number | boolean | readonly string[];
  readonly resolved_discrepancies_found: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F094MultidocComparisonMatrixAuditEntry;
}

export interface F094MultidocComparisonMatrixTelemetrySnapshot {
  readonly featureId: typeof F094_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F094_CONFIG: F094MultidocComparisonMatrixConfig = {
  featureId: F094_FEATURE_ID,
  stage: F094_STAGE,
  operationCode: F094_OPERATION_CODE,
  contractVersion: F094_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F094MultidocComparisonMatrixValidationError extends Error {
  public readonly featureId = F094_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F094 Validation Error on '${field}']: ${message}`);
    this.name = "F094MultidocComparisonMatrixValidationError";
    this.field = field;
  }
}

export function computeF094Digest(rawPayload: string): string {
  return `f094_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F094MultidocComparisonMatrixEngine {
  private readonly config: F094MultidocComparisonMatrixConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F094MultidocComparisonMatrixOutput[] = [];
  private readonly auditLog: F094MultidocComparisonMatrixAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F094MultidocComparisonMatrixOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F094MultidocComparisonMatrixConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F094_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F094MultidocComparisonMatrixConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F094MultidocComparisonMatrixInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F094MultidocComparisonMatrixValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.matrix_id).trim().length === 0) {
      throw new F094MultidocComparisonMatrixValidationError("matrix_id", "Primary domain attribute 'matrix_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      matrix_id: input.matrix_id,
      compared_docs_count: input.compared_docs_count,
      criteria_columns: input.criteria_columns,
      discrepancies_found: input.discrepancies_found
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F094MultidocComparisonMatrixValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F094MultidocComparisonMatrixInput): F094MultidocComparisonMatrixOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F094_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        matrix_id: input.matrix_id,
        compared_docs_count: input.compared_docs_count,
        criteria_columns: input.criteria_columns,
        discrepancies_found: input.discrepancies_found
      });
      const payloadHash = computeF094Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F094MultidocComparisonMatrixValidationError(
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
        featureId: F094_FEATURE_ID,
        operationCode: F094_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          matrix_id: input.matrix_id,
          compared_docs_count: input.compared_docs_count,
          criteria_columns: input.criteria_columns,
          discrepancies_found: input.discrepancies_found
        }
      });

      const executionId = `exec_f094_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f094_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F094MultidocComparisonMatrixAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F094_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `multidoc_matrix_builder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F094MultidocComparisonMatrixOutput = {
        featureId: F094_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F094_OPERATION_CODE,
        resolved_matrix_id: kernelResult.resolvedFields.matrix_id as string,
        resolved_compared_docs_count: kernelResult.resolvedFields.compared_docs_count as string | number,
        resolved_criteria_columns: kernelResult.resolvedFields.criteria_columns as string | number | boolean | readonly string[],
        resolved_discrepancies_found: kernelResult.resolvedFields.discrepancies_found as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F094MultidocComparisonMatrixTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F094_FEATURE_ID,
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

  public getAuditTrail(): readonly F094MultidocComparisonMatrixAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F094MultidocComparisonMatrixOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF094Module(): {
  featureId: typeof F094_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F094MultidocComparisonMatrixEngine();
  const sampleInput: F094MultidocComparisonMatrixInput = {
    requestId: "req_verify_f094",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    matrix_id: "f094_matrix_id_seed",
    compared_docs_count: 42,
    criteria_columns: true,
    discrepancies_found: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 94 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F094" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_matrix_id !== sampleInput.matrix_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F094_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
