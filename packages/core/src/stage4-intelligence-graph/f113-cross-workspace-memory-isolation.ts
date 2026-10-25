/**
 * F113 (stage4-intelligence-graph): Изоляция памяти между воркспейсами
 * Строгий запрет на протекание данных одного клиентского проекта в граф другого
 * Operation Code: workspace_isolation_fence
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F113_FEATURE_ID = "F113" as const;
export const F113_STAGE = "stage4-intelligence-graph" as const;
export const F113_OPERATION_CODE = "workspace_isolation_fence" as const;
export const F113_CONTRACT_VERSION = "2.0.0" as const;

export type F113CrossWorkspaceMemoryIsolationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F113CrossWorkspaceMemoryIsolationConfig {
  readonly featureId: typeof F113_FEATURE_ID;
  readonly stage: typeof F113_STAGE;
  readonly operationCode: typeof F113_OPERATION_CODE;
  readonly contractVersion: typeof F113_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F113CrossWorkspaceMemoryIsolationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_workspace_id: string;
  readonly target_workspace_id: string | number;
  readonly cross_leak_blocked: string | number | boolean | readonly string[];
  readonly isolation_verified: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F113CrossWorkspaceMemoryIsolationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F113_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F113CrossWorkspaceMemoryIsolationOutput {
  readonly featureId: typeof F113_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F113CrossWorkspaceMemoryIsolationExecutionStatus;
  readonly operationCode: typeof F113_OPERATION_CODE;
  readonly resolved_source_workspace_id: string;
  readonly resolved_target_workspace_id: string | number;
  readonly resolved_cross_leak_blocked: string | number | boolean | readonly string[];
  readonly resolved_isolation_verified: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F113CrossWorkspaceMemoryIsolationAuditEntry;
}

export interface F113CrossWorkspaceMemoryIsolationTelemetrySnapshot {
  readonly featureId: typeof F113_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F113_CONFIG: F113CrossWorkspaceMemoryIsolationConfig = {
  featureId: F113_FEATURE_ID,
  stage: F113_STAGE,
  operationCode: F113_OPERATION_CODE,
  contractVersion: F113_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F113CrossWorkspaceMemoryIsolationValidationError extends Error {
  public readonly featureId = F113_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F113 Validation Error on '${field}']: ${message}`);
    this.name = "F113CrossWorkspaceMemoryIsolationValidationError";
    this.field = field;
  }
}

export function computeF113Digest(rawPayload: string): string {
  return `f113_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F113CrossWorkspaceMemoryIsolationEngine {
  private readonly config: F113CrossWorkspaceMemoryIsolationConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F113CrossWorkspaceMemoryIsolationOutput[] = [];
  private readonly auditLog: F113CrossWorkspaceMemoryIsolationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F113CrossWorkspaceMemoryIsolationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F113CrossWorkspaceMemoryIsolationConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F113_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F113CrossWorkspaceMemoryIsolationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F113CrossWorkspaceMemoryIsolationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.source_workspace_id).trim().length === 0) {
      throw new F113CrossWorkspaceMemoryIsolationValidationError("source_workspace_id", "Primary domain attribute 'source_workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      source_workspace_id: input.source_workspace_id,
      target_workspace_id: input.target_workspace_id,
      cross_leak_blocked: input.cross_leak_blocked,
      isolation_verified: input.isolation_verified
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F113CrossWorkspaceMemoryIsolationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F113CrossWorkspaceMemoryIsolationInput): F113CrossWorkspaceMemoryIsolationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F113_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        source_workspace_id: input.source_workspace_id,
        target_workspace_id: input.target_workspace_id,
        cross_leak_blocked: input.cross_leak_blocked,
        isolation_verified: input.isolation_verified
      });
      const payloadHash = computeF113Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F113CrossWorkspaceMemoryIsolationValidationError(
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
        featureId: F113_FEATURE_ID,
        operationCode: F113_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          source_workspace_id: input.source_workspace_id,
          target_workspace_id: input.target_workspace_id,
          cross_leak_blocked: input.cross_leak_blocked,
          isolation_verified: input.isolation_verified
        }
      });

      const executionId = `exec_f113_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f113_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F113CrossWorkspaceMemoryIsolationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F113_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `workspace_isolation_fence:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F113CrossWorkspaceMemoryIsolationOutput = {
        featureId: F113_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F113_OPERATION_CODE,
        resolved_source_workspace_id: kernelResult.resolvedFields.source_workspace_id as string,
        resolved_target_workspace_id: kernelResult.resolvedFields.target_workspace_id as string | number,
        resolved_cross_leak_blocked: kernelResult.resolvedFields.cross_leak_blocked as string | number | boolean | readonly string[],
        resolved_isolation_verified: kernelResult.resolvedFields.isolation_verified as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F113CrossWorkspaceMemoryIsolationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F113_FEATURE_ID,
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

  public getAuditTrail(): readonly F113CrossWorkspaceMemoryIsolationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F113CrossWorkspaceMemoryIsolationOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF113Module(): {
  featureId: typeof F113_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F113CrossWorkspaceMemoryIsolationEngine();
  const sampleInput: F113CrossWorkspaceMemoryIsolationInput = {
    requestId: "req_verify_f113",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_workspace_id: "f113_source_workspace_id_seed",
    target_workspace_id: 42,
    cross_leak_blocked: true,
    isolation_verified: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 113 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F113" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_workspace_id !== sampleInput.source_workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F113_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
