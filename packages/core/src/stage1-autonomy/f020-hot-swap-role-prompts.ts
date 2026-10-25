/**
 * F020 (stage1-autonomy): Горячая замена промптов ролей
 * Обновление системных инструкций агентов без перезапуска рантайма
 * Operation Code: prompt_hotswap
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F020_FEATURE_ID = "F020" as const;
export const F020_STAGE = "stage1-autonomy" as const;
export const F020_OPERATION_CODE = "prompt_hotswap" as const;
export const F020_CONTRACT_VERSION = "2.0.0" as const;

export type F020HotSwapRolePromptsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F020HotSwapRolePromptsConfig {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly stage: typeof F020_STAGE;
  readonly operationCode: typeof F020_OPERATION_CODE;
  readonly contractVersion: typeof F020_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F020HotSwapRolePromptsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly role_name: string;
  readonly previous_version: string | number;
  readonly active_version: string | number | boolean | readonly string[];
  readonly zero_downtime_applied: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F020HotSwapRolePromptsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F020_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F020HotSwapRolePromptsOutput {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F020HotSwapRolePromptsExecutionStatus;
  readonly operationCode: typeof F020_OPERATION_CODE;
  readonly resolved_role_name: string;
  readonly resolved_previous_version: string | number;
  readonly resolved_active_version: string | number | boolean | readonly string[];
  readonly resolved_zero_downtime_applied: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F020HotSwapRolePromptsAuditEntry;
}

export interface F020HotSwapRolePromptsTelemetrySnapshot {
  readonly featureId: typeof F020_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F020_CONFIG: F020HotSwapRolePromptsConfig = {
  featureId: F020_FEATURE_ID,
  stage: F020_STAGE,
  operationCode: F020_OPERATION_CODE,
  contractVersion: F020_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F020HotSwapRolePromptsValidationError extends Error {
  public readonly featureId = F020_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F020 Validation Error on '${field}']: ${message}`);
    this.name = "F020HotSwapRolePromptsValidationError";
    this.field = field;
  }
}

export function computeF020Digest(rawPayload: string): string {
  return `f020_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F020HotSwapRolePromptsEngine {
  private readonly config: F020HotSwapRolePromptsConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F020HotSwapRolePromptsOutput[] = [];
  private readonly auditLog: F020HotSwapRolePromptsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F020HotSwapRolePromptsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F020HotSwapRolePromptsConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F020_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F020HotSwapRolePromptsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F020HotSwapRolePromptsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F020HotSwapRolePromptsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.role_name).trim().length === 0) {
      throw new F020HotSwapRolePromptsValidationError("role_name", "Primary domain attribute 'role_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      role_name: input.role_name,
      previous_version: input.previous_version,
      active_version: input.active_version,
      zero_downtime_applied: input.zero_downtime_applied
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F020HotSwapRolePromptsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F020HotSwapRolePromptsInput): F020HotSwapRolePromptsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F020_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        role_name: input.role_name,
        previous_version: input.previous_version,
        active_version: input.active_version,
        zero_downtime_applied: input.zero_downtime_applied
      });
      const payloadHash = computeF020Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F020HotSwapRolePromptsValidationError(
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
        featureId: F020_FEATURE_ID,
        operationCode: F020_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          role_name: input.role_name,
          previous_version: input.previous_version,
          active_version: input.active_version,
          zero_downtime_applied: input.zero_downtime_applied
        }
      });

      const executionId = `exec_f020_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f020_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F020HotSwapRolePromptsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F020_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `prompt_hotswap:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F020HotSwapRolePromptsOutput = {
        featureId: F020_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F020_OPERATION_CODE,
        resolved_role_name: kernelResult.resolvedFields.role_name as string,
        resolved_previous_version: kernelResult.resolvedFields.previous_version as string | number,
        resolved_active_version: kernelResult.resolvedFields.active_version as string | number | boolean | readonly string[],
        resolved_zero_downtime_applied: kernelResult.resolvedFields.zero_downtime_applied as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F020HotSwapRolePromptsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F020_FEATURE_ID,
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

  public getAuditTrail(): readonly F020HotSwapRolePromptsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F020HotSwapRolePromptsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF020Module(): {
  featureId: typeof F020_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F020HotSwapRolePromptsEngine();
  const sampleInput: F020HotSwapRolePromptsInput = {
    requestId: "req_verify_f020",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    role_name: "f020_role_name_seed",
    previous_version: 42,
    active_version: true,
    zero_downtime_applied: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 20 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F020" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_role_name !== sampleInput.role_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F020_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
