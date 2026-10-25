/**
 * F023 (stage1-autonomy): Бюджетирование токенов на задачу
 * Жёсткий лимит стоимости одного запуска графа с защитой от перерасхода
 * Operation Code: token_budget_guard
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F023_FEATURE_ID = "F023" as const;
export const F023_STAGE = "stage1-autonomy" as const;
export const F023_OPERATION_CODE = "token_budget_guard" as const;
export const F023_CONTRACT_VERSION = "2.0.0" as const;

export type F023TaskTokenBudgetingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F023TaskTokenBudgetingConfig {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly stage: typeof F023_STAGE;
  readonly operationCode: typeof F023_OPERATION_CODE;
  readonly contractVersion: typeof F023_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F023TaskTokenBudgetingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly allocated_tokens: string | number;
  readonly consumed_tokens: string | number | boolean | readonly string[];
  readonly budget_remaining: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F023TaskTokenBudgetingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F023_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F023TaskTokenBudgetingOutput {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F023TaskTokenBudgetingExecutionStatus;
  readonly operationCode: typeof F023_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_allocated_tokens: string | number;
  readonly resolved_consumed_tokens: string | number | boolean | readonly string[];
  readonly resolved_budget_remaining: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F023TaskTokenBudgetingAuditEntry;
}

export interface F023TaskTokenBudgetingTelemetrySnapshot {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F023_CONFIG: F023TaskTokenBudgetingConfig = {
  featureId: F023_FEATURE_ID,
  stage: F023_STAGE,
  operationCode: F023_OPERATION_CODE,
  contractVersion: F023_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F023TaskTokenBudgetingValidationError extends Error {
  public readonly featureId = F023_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F023 Validation Error on '${field}']: ${message}`);
    this.name = "F023TaskTokenBudgetingValidationError";
    this.field = field;
  }
}

export function computeF023Digest(rawPayload: string): string {
  return `f023_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F023TaskTokenBudgetingEngine {
  private readonly config: F023TaskTokenBudgetingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F023TaskTokenBudgetingOutput[] = [];
  private readonly auditLog: F023TaskTokenBudgetingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F023TaskTokenBudgetingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F023TaskTokenBudgetingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F023_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F023TaskTokenBudgetingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F023TaskTokenBudgetingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F023TaskTokenBudgetingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      graph_id: input.graph_id,
      allocated_tokens: input.allocated_tokens,
      consumed_tokens: input.consumed_tokens,
      budget_remaining: input.budget_remaining
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F023TaskTokenBudgetingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F023TaskTokenBudgetingInput): F023TaskTokenBudgetingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F023_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        graph_id: input.graph_id,
        allocated_tokens: input.allocated_tokens,
        consumed_tokens: input.consumed_tokens,
        budget_remaining: input.budget_remaining
      });
      const payloadHash = computeF023Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F023TaskTokenBudgetingValidationError(
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
        featureId: F023_FEATURE_ID,
        operationCode: F023_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          graph_id: input.graph_id,
          allocated_tokens: input.allocated_tokens,
          consumed_tokens: input.consumed_tokens,
          budget_remaining: input.budget_remaining
        }
      });

      const executionId = `exec_f023_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f023_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F023TaskTokenBudgetingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F023_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `token_budget_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F023TaskTokenBudgetingOutput = {
        featureId: F023_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F023_OPERATION_CODE,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string,
        resolved_allocated_tokens: kernelResult.resolvedFields.allocated_tokens as string | number,
        resolved_consumed_tokens: kernelResult.resolvedFields.consumed_tokens as string | number | boolean | readonly string[],
        resolved_budget_remaining: kernelResult.resolvedFields.budget_remaining as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F023TaskTokenBudgetingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F023_FEATURE_ID,
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

  public getAuditTrail(): readonly F023TaskTokenBudgetingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F023TaskTokenBudgetingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF023Module(): {
  featureId: typeof F023_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F023TaskTokenBudgetingEngine();
  const sampleInput: F023TaskTokenBudgetingInput = {
    requestId: "req_verify_f023",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f023_graph_id_seed",
    allocated_tokens: 42,
    consumed_tokens: true,
    budget_remaining: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 23 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F023" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F023_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
