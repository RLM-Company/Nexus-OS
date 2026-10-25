/**
 * F010 (stage1-autonomy): Детектор зацикливания агентов
 * Принудительное прерывание бесконечных споров между Исполнителем и Критиком после N итераций
 * Operation Code: loop_breaker
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F010_FEATURE_ID = "F010" as const;
export const F010_STAGE = "stage1-autonomy" as const;
export const F010_OPERATION_CODE = "loop_breaker" as const;
export const F010_CONTRACT_VERSION = "2.0.0" as const;

export type F010AgentLoopDetectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F010AgentLoopDetectorConfig {
  readonly featureId: typeof F010_FEATURE_ID;
  readonly stage: typeof F010_STAGE;
  readonly operationCode: typeof F010_OPERATION_CODE;
  readonly contractVersion: typeof F010_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F010AgentLoopDetectorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly task_id: string;
  readonly iteration_count: string | number;
  readonly max_iterations: string | number | boolean | readonly string[];
  readonly loop_terminated: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F010AgentLoopDetectorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F010_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F010AgentLoopDetectorOutput {
  readonly featureId: typeof F010_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F010AgentLoopDetectorExecutionStatus;
  readonly operationCode: typeof F010_OPERATION_CODE;
  readonly resolved_task_id: string;
  readonly resolved_iteration_count: string | number;
  readonly resolved_max_iterations: string | number | boolean | readonly string[];
  readonly resolved_loop_terminated: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F010AgentLoopDetectorAuditEntry;
}

export interface F010AgentLoopDetectorTelemetrySnapshot {
  readonly featureId: typeof F010_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F010_CONFIG: F010AgentLoopDetectorConfig = {
  featureId: F010_FEATURE_ID,
  stage: F010_STAGE,
  operationCode: F010_OPERATION_CODE,
  contractVersion: F010_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F010AgentLoopDetectorValidationError extends Error {
  public readonly featureId = F010_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F010 Validation Error on '${field}']: ${message}`);
    this.name = "F010AgentLoopDetectorValidationError";
    this.field = field;
  }
}

export function computeF010Digest(rawPayload: string): string {
  return `f010_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F010AgentLoopDetectorEngine {
  private readonly config: F010AgentLoopDetectorConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F010AgentLoopDetectorOutput[] = [];
  private readonly auditLog: F010AgentLoopDetectorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F010AgentLoopDetectorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F010AgentLoopDetectorConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F010_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F010AgentLoopDetectorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F010AgentLoopDetectorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F010AgentLoopDetectorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.task_id).trim().length === 0) {
      throw new F010AgentLoopDetectorValidationError("task_id", "Primary domain attribute 'task_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      task_id: input.task_id,
      iteration_count: input.iteration_count,
      max_iterations: input.max_iterations,
      loop_terminated: input.loop_terminated
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F010AgentLoopDetectorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F010AgentLoopDetectorInput): F010AgentLoopDetectorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F010_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        task_id: input.task_id,
        iteration_count: input.iteration_count,
        max_iterations: input.max_iterations,
        loop_terminated: input.loop_terminated
      });
      const payloadHash = computeF010Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F010AgentLoopDetectorValidationError(
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
        featureId: F010_FEATURE_ID,
        operationCode: F010_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          task_id: input.task_id,
          iteration_count: input.iteration_count,
          max_iterations: input.max_iterations,
          loop_terminated: input.loop_terminated
        }
      });

      const executionId = `exec_f010_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f010_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F010AgentLoopDetectorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F010_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `loop_breaker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F010AgentLoopDetectorOutput = {
        featureId: F010_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F010_OPERATION_CODE,
        resolved_task_id: kernelResult.resolvedFields.task_id as string,
        resolved_iteration_count: kernelResult.resolvedFields.iteration_count as string | number,
        resolved_max_iterations: kernelResult.resolvedFields.max_iterations as string | number | boolean | readonly string[],
        resolved_loop_terminated: kernelResult.resolvedFields.loop_terminated as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F010AgentLoopDetectorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F010_FEATURE_ID,
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

  public getAuditTrail(): readonly F010AgentLoopDetectorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F010AgentLoopDetectorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF010Module(): {
  featureId: typeof F010_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F010AgentLoopDetectorEngine();
  const sampleInput: F010AgentLoopDetectorInput = {
    requestId: "req_verify_f010",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    task_id: "f010_task_id_seed",
    iteration_count: 42,
    max_iterations: true,
    loop_terminated: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 10 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F010" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_task_id !== sampleInput.task_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F010_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
