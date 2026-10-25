/**
 * F001 (stage1-autonomy): Инициализация протокола Kosmora
 * Единый стандарт обмена сообщениями и состояниями между оркестратором и воркерами
 * Operation Code: protocol_handshake
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F001_FEATURE_ID = "F001" as const;
export const F001_STAGE = "stage1-autonomy" as const;
export const F001_OPERATION_CODE = "protocol_handshake" as const;
export const F001_CONTRACT_VERSION = "2.0.0" as const;

export type F001KosmoraProtocolInitExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F001KosmoraProtocolInitConfig {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly stage: typeof F001_STAGE;
  readonly operationCode: typeof F001_OPERATION_CODE;
  readonly contractVersion: typeof F001_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F001KosmoraProtocolInitInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly protocol_version: string;
  readonly sender_role: string | number;
  readonly recipient_role: string | number | boolean | readonly string[];
  readonly correlation_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F001KosmoraProtocolInitAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F001_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F001KosmoraProtocolInitOutput {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F001KosmoraProtocolInitExecutionStatus;
  readonly operationCode: typeof F001_OPERATION_CODE;
  readonly resolved_protocol_version: string;
  readonly resolved_sender_role: string | number;
  readonly resolved_recipient_role: string | number | boolean | readonly string[];
  readonly resolved_correlation_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F001KosmoraProtocolInitAuditEntry;
}

export interface F001KosmoraProtocolInitTelemetrySnapshot {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F001_CONFIG: F001KosmoraProtocolInitConfig = {
  featureId: F001_FEATURE_ID,
  stage: F001_STAGE,
  operationCode: F001_OPERATION_CODE,
  contractVersion: F001_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F001KosmoraProtocolInitValidationError extends Error {
  public readonly featureId = F001_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F001 Validation Error on '${field}']: ${message}`);
    this.name = "F001KosmoraProtocolInitValidationError";
    this.field = field;
  }
}

export function computeF001Digest(rawPayload: string): string {
  return `f001_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F001KosmoraProtocolInitEngine {
  private readonly config: F001KosmoraProtocolInitConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F001KosmoraProtocolInitOutput[] = [];
  private readonly auditLog: F001KosmoraProtocolInitAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F001KosmoraProtocolInitOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F001KosmoraProtocolInitConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F001_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F001KosmoraProtocolInitConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F001KosmoraProtocolInitInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F001KosmoraProtocolInitValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.protocol_version).trim().length === 0) {
      throw new F001KosmoraProtocolInitValidationError("protocol_version", "Primary domain attribute 'protocol_version' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      protocol_version: input.protocol_version,
      sender_role: input.sender_role,
      recipient_role: input.recipient_role,
      correlation_id: input.correlation_id
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F001KosmoraProtocolInitValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F001KosmoraProtocolInitInput): F001KosmoraProtocolInitOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F001_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        protocol_version: input.protocol_version,
        sender_role: input.sender_role,
        recipient_role: input.recipient_role,
        correlation_id: input.correlation_id
      });
      const payloadHash = computeF001Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F001KosmoraProtocolInitValidationError(
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
        featureId: F001_FEATURE_ID,
        operationCode: F001_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          protocol_version: input.protocol_version,
          sender_role: input.sender_role,
          recipient_role: input.recipient_role,
          correlation_id: input.correlation_id
        }
      });

      const executionId = `exec_f001_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f001_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F001KosmoraProtocolInitAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F001_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `protocol_handshake:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F001KosmoraProtocolInitOutput = {
        featureId: F001_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F001_OPERATION_CODE,
        resolved_protocol_version: kernelResult.resolvedFields.protocol_version as string,
        resolved_sender_role: kernelResult.resolvedFields.sender_role as string | number,
        resolved_recipient_role: kernelResult.resolvedFields.recipient_role as string | number | boolean | readonly string[],
        resolved_correlation_id: kernelResult.resolvedFields.correlation_id as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F001KosmoraProtocolInitTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F001_FEATURE_ID,
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

  public getAuditTrail(): readonly F001KosmoraProtocolInitAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F001KosmoraProtocolInitOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF001Module(): {
  featureId: typeof F001_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F001KosmoraProtocolInitEngine();
  const sampleInput: F001KosmoraProtocolInitInput = {
    requestId: "req_verify_f001",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    protocol_version: "f001_protocol_version_seed",
    sender_role: 42,
    recipient_role: true,
    correlation_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 1 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F001" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_protocol_version !== sampleInput.protocol_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F001_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
