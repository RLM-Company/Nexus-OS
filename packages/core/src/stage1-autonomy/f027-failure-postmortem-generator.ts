/**
 * F027 (stage1-autonomy): Генерация пост-мортем отчётов при сбое
 * Автоматический разбор причины падения цепочки задач
 * Operation Code: postmortem_analyzer
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F027_FEATURE_ID = "F027" as const;
export const F027_STAGE = "stage1-autonomy" as const;
export const F027_OPERATION_CODE = "postmortem_analyzer" as const;
export const F027_CONTRACT_VERSION = "2.0.0" as const;

export type F027FailurePostmortemGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F027FailurePostmortemGeneratorConfig {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly stage: typeof F027_STAGE;
  readonly operationCode: typeof F027_OPERATION_CODE;
  readonly contractVersion: typeof F027_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F027FailurePostmortemGeneratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly report_id: string;
  readonly failed_node_id: string | number;
  readonly root_cause: string | number | boolean | readonly string[];
  readonly recovery_recommendation: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F027FailurePostmortemGeneratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F027_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F027FailurePostmortemGeneratorOutput {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F027FailurePostmortemGeneratorExecutionStatus;
  readonly operationCode: typeof F027_OPERATION_CODE;
  readonly resolved_report_id: string;
  readonly resolved_failed_node_id: string | number;
  readonly resolved_root_cause: string | number | boolean | readonly string[];
  readonly resolved_recovery_recommendation: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F027FailurePostmortemGeneratorAuditEntry;
}

export interface F027FailurePostmortemGeneratorTelemetrySnapshot {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F027_CONFIG: F027FailurePostmortemGeneratorConfig = {
  featureId: F027_FEATURE_ID,
  stage: F027_STAGE,
  operationCode: F027_OPERATION_CODE,
  contractVersion: F027_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F027FailurePostmortemGeneratorValidationError extends Error {
  public readonly featureId = F027_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F027 Validation Error on '${field}']: ${message}`);
    this.name = "F027FailurePostmortemGeneratorValidationError";
    this.field = field;
  }
}

export function computeF027Digest(rawPayload: string): string {
  return `f027_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F027FailurePostmortemGeneratorEngine {
  private readonly config: F027FailurePostmortemGeneratorConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F027FailurePostmortemGeneratorOutput[] = [];
  private readonly auditLog: F027FailurePostmortemGeneratorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F027FailurePostmortemGeneratorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F027FailurePostmortemGeneratorConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F027_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F027FailurePostmortemGeneratorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F027FailurePostmortemGeneratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F027FailurePostmortemGeneratorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.report_id).trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("report_id", "Primary domain attribute 'report_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      report_id: input.report_id,
      failed_node_id: input.failed_node_id,
      root_cause: input.root_cause,
      recovery_recommendation: input.recovery_recommendation
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F027FailurePostmortemGeneratorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F027FailurePostmortemGeneratorInput): F027FailurePostmortemGeneratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F027_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        report_id: input.report_id,
        failed_node_id: input.failed_node_id,
        root_cause: input.root_cause,
        recovery_recommendation: input.recovery_recommendation
      });
      const payloadHash = computeF027Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F027FailurePostmortemGeneratorValidationError(
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
        featureId: F027_FEATURE_ID,
        operationCode: F027_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          report_id: input.report_id,
          failed_node_id: input.failed_node_id,
          root_cause: input.root_cause,
          recovery_recommendation: input.recovery_recommendation
        }
      });

      const executionId = `exec_f027_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f027_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F027FailurePostmortemGeneratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F027_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `postmortem_analyzer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F027FailurePostmortemGeneratorOutput = {
        featureId: F027_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F027_OPERATION_CODE,
        resolved_report_id: kernelResult.resolvedFields.report_id as string,
        resolved_failed_node_id: kernelResult.resolvedFields.failed_node_id as string | number,
        resolved_root_cause: kernelResult.resolvedFields.root_cause as string | number | boolean | readonly string[],
        resolved_recovery_recommendation: kernelResult.resolvedFields.recovery_recommendation as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F027FailurePostmortemGeneratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F027_FEATURE_ID,
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

  public getAuditTrail(): readonly F027FailurePostmortemGeneratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F027FailurePostmortemGeneratorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF027Module(): {
  featureId: typeof F027_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F027FailurePostmortemGeneratorEngine();
  const sampleInput: F027FailurePostmortemGeneratorInput = {
    requestId: "req_verify_f027",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    report_id: "f027_report_id_seed",
    failed_node_id: 42,
    root_cause: true,
    recovery_recommendation: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 27 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F027" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_report_id !== sampleInput.report_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F027_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
