/**
 * F019 (stage1-autonomy): Точки перехвата человеком (Human-in-the-Loop Breakpoints)
 * Пауза выполнения графа перед критическими действиями (удаление, пуш в прод, внешняя отправка)
 * Operation Code: hitl_gate
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F019_FEATURE_ID = "F019" as const;
export const F019_STAGE = "stage1-autonomy" as const;
export const F019_OPERATION_CODE = "hitl_gate" as const;
export const F019_CONTRACT_VERSION = "2.0.0" as const;

export type F019HitlBreakpointsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F019HitlBreakpointsConfig {
  readonly featureId: typeof F019_FEATURE_ID;
  readonly stage: typeof F019_STAGE;
  readonly operationCode: typeof F019_OPERATION_CODE;
  readonly contractVersion: typeof F019_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F019HitlBreakpointsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly breakpoint_id: string;
  readonly critical_action: string | number;
  readonly paused_state: string | number | boolean | readonly string[];
  readonly owner_signature: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F019HitlBreakpointsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F019_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F019HitlBreakpointsOutput {
  readonly featureId: typeof F019_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F019HitlBreakpointsExecutionStatus;
  readonly operationCode: typeof F019_OPERATION_CODE;
  readonly resolved_breakpoint_id: string;
  readonly resolved_critical_action: string | number;
  readonly resolved_paused_state: string | number | boolean | readonly string[];
  readonly resolved_owner_signature: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F019HitlBreakpointsAuditEntry;
}

export interface F019HitlBreakpointsTelemetrySnapshot {
  readonly featureId: typeof F019_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F019_CONFIG: F019HitlBreakpointsConfig = {
  featureId: F019_FEATURE_ID,
  stage: F019_STAGE,
  operationCode: F019_OPERATION_CODE,
  contractVersion: F019_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F019HitlBreakpointsValidationError extends Error {
  public readonly featureId = F019_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F019 Validation Error on '${field}']: ${message}`);
    this.name = "F019HitlBreakpointsValidationError";
    this.field = field;
  }
}

export function computeF019Digest(rawPayload: string): string {
  return `f019_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F019HitlBreakpointsEngine {
  private readonly config: F019HitlBreakpointsConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F019HitlBreakpointsOutput[] = [];
  private readonly auditLog: F019HitlBreakpointsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F019HitlBreakpointsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F019HitlBreakpointsConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F019_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F019HitlBreakpointsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F019HitlBreakpointsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F019HitlBreakpointsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.breakpoint_id).trim().length === 0) {
      throw new F019HitlBreakpointsValidationError("breakpoint_id", "Primary domain attribute 'breakpoint_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      breakpoint_id: input.breakpoint_id,
      critical_action: input.critical_action,
      paused_state: input.paused_state,
      owner_signature: input.owner_signature
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F019HitlBreakpointsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F019HitlBreakpointsInput): F019HitlBreakpointsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F019_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        breakpoint_id: input.breakpoint_id,
        critical_action: input.critical_action,
        paused_state: input.paused_state,
        owner_signature: input.owner_signature
      });
      const payloadHash = computeF019Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F019HitlBreakpointsValidationError(
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
        featureId: F019_FEATURE_ID,
        operationCode: F019_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          breakpoint_id: input.breakpoint_id,
          critical_action: input.critical_action,
          paused_state: input.paused_state,
          owner_signature: input.owner_signature
        }
      });

      const executionId = `exec_f019_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f019_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F019HitlBreakpointsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F019_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `hitl_gate:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F019HitlBreakpointsOutput = {
        featureId: F019_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F019_OPERATION_CODE,
        resolved_breakpoint_id: kernelResult.resolvedFields.breakpoint_id as string,
        resolved_critical_action: kernelResult.resolvedFields.critical_action as string | number,
        resolved_paused_state: kernelResult.resolvedFields.paused_state as string | number | boolean | readonly string[],
        resolved_owner_signature: kernelResult.resolvedFields.owner_signature as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F019HitlBreakpointsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F019_FEATURE_ID,
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

  public getAuditTrail(): readonly F019HitlBreakpointsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F019HitlBreakpointsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF019Module(): {
  featureId: typeof F019_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F019HitlBreakpointsEngine();
  const sampleInput: F019HitlBreakpointsInput = {
    requestId: "req_verify_f019",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    breakpoint_id: "f019_breakpoint_id_seed",
    critical_action: 42,
    paused_state: true,
    owner_signature: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 19 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F019" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_breakpoint_id !== sampleInput.breakpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F019_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
