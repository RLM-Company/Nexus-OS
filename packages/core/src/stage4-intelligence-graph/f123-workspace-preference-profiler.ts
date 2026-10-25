/**
 * F123 (stage4-intelligence-graph): Персональный профиль предпочтений внутри воркспейса
 * Запоминание любимого формата таблиц, стиля кода и лаконичности ответов
 * Operation Code: preference_memory_profile
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F123_FEATURE_ID = "F123" as const;
export const F123_STAGE = "stage4-intelligence-graph" as const;
export const F123_OPERATION_CODE = "preference_memory_profile" as const;
export const F123_CONTRACT_VERSION = "2.0.0" as const;

export type F123WorkspacePreferenceProfilerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F123WorkspacePreferenceProfilerConfig {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly stage: typeof F123_STAGE;
  readonly operationCode: typeof F123_OPERATION_CODE;
  readonly contractVersion: typeof F123_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F123WorkspacePreferenceProfilerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly preferred_table_style: string | number;
  readonly preferred_code_idiom: string | number | boolean | readonly string[];
  readonly verbosity_level: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F123WorkspacePreferenceProfilerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F123_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F123WorkspacePreferenceProfilerOutput {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F123WorkspacePreferenceProfilerExecutionStatus;
  readonly operationCode: typeof F123_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_preferred_table_style: string | number;
  readonly resolved_preferred_code_idiom: string | number | boolean | readonly string[];
  readonly resolved_verbosity_level: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F123WorkspacePreferenceProfilerAuditEntry;
}

export interface F123WorkspacePreferenceProfilerTelemetrySnapshot {
  readonly featureId: typeof F123_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F123_CONFIG: F123WorkspacePreferenceProfilerConfig = {
  featureId: F123_FEATURE_ID,
  stage: F123_STAGE,
  operationCode: F123_OPERATION_CODE,
  contractVersion: F123_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F123WorkspacePreferenceProfilerValidationError extends Error {
  public readonly featureId = F123_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F123 Validation Error on '${field}']: ${message}`);
    this.name = "F123WorkspacePreferenceProfilerValidationError";
    this.field = field;
  }
}

export function computeF123Digest(rawPayload: string): string {
  return `f123_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F123WorkspacePreferenceProfilerEngine {
  private readonly config: F123WorkspacePreferenceProfilerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F123WorkspacePreferenceProfilerOutput[] = [];
  private readonly auditLog: F123WorkspacePreferenceProfilerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F123WorkspacePreferenceProfilerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F123WorkspacePreferenceProfilerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F123_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F123WorkspacePreferenceProfilerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F123WorkspacePreferenceProfilerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F123WorkspacePreferenceProfilerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F123WorkspacePreferenceProfilerValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      preferred_table_style: input.preferred_table_style,
      preferred_code_idiom: input.preferred_code_idiom,
      verbosity_level: input.verbosity_level
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F123WorkspacePreferenceProfilerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F123WorkspacePreferenceProfilerInput): F123WorkspacePreferenceProfilerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F123_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        preferred_table_style: input.preferred_table_style,
        preferred_code_idiom: input.preferred_code_idiom,
        verbosity_level: input.verbosity_level
      });
      const payloadHash = computeF123Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F123WorkspacePreferenceProfilerValidationError(
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
        featureId: F123_FEATURE_ID,
        operationCode: F123_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          preferred_table_style: input.preferred_table_style,
          preferred_code_idiom: input.preferred_code_idiom,
          verbosity_level: input.verbosity_level
        }
      });

      const executionId = `exec_f123_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f123_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F123WorkspacePreferenceProfilerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F123_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `preference_memory_profile:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F123WorkspacePreferenceProfilerOutput = {
        featureId: F123_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F123_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_preferred_table_style: kernelResult.resolvedFields.preferred_table_style as string | number,
        resolved_preferred_code_idiom: kernelResult.resolvedFields.preferred_code_idiom as string | number | boolean | readonly string[],
        resolved_verbosity_level: kernelResult.resolvedFields.verbosity_level as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F123WorkspacePreferenceProfilerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F123_FEATURE_ID,
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

  public getAuditTrail(): readonly F123WorkspacePreferenceProfilerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F123WorkspacePreferenceProfilerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF123Module(): {
  featureId: typeof F123_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F123WorkspacePreferenceProfilerEngine();
  const sampleInput: F123WorkspacePreferenceProfilerInput = {
    requestId: "req_verify_f123",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f123_workspace_id_seed",
    preferred_table_style: 42,
    preferred_code_idiom: true,
    verbosity_level: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 123 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F123" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F123_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
