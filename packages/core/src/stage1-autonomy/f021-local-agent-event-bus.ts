/**
 * F021 (stage1-autonomy): Локальная шина событий агентов (Event Bus)
 * Реактивный обмен сигналами между модулями через Pub/Sub
 * Operation Code: pubsub_bus
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F021_FEATURE_ID = "F021" as const;
export const F021_STAGE = "stage1-autonomy" as const;
export const F021_OPERATION_CODE = "pubsub_bus" as const;
export const F021_CONTRACT_VERSION = "2.0.0" as const;

export type F021LocalAgentEventBusExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F021LocalAgentEventBusConfig {
  readonly featureId: typeof F021_FEATURE_ID;
  readonly stage: typeof F021_STAGE;
  readonly operationCode: typeof F021_OPERATION_CODE;
  readonly contractVersion: typeof F021_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F021LocalAgentEventBusInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly topic_name: string;
  readonly subscriber_count: string | number;
  readonly published_event_id: string | number | boolean | readonly string[];
  readonly delivery_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F021LocalAgentEventBusAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F021_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F021LocalAgentEventBusOutput {
  readonly featureId: typeof F021_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F021LocalAgentEventBusExecutionStatus;
  readonly operationCode: typeof F021_OPERATION_CODE;
  readonly resolved_topic_name: string;
  readonly resolved_subscriber_count: string | number;
  readonly resolved_published_event_id: string | number | boolean | readonly string[];
  readonly resolved_delivery_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F021LocalAgentEventBusAuditEntry;
}

export interface F021LocalAgentEventBusTelemetrySnapshot {
  readonly featureId: typeof F021_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F021_CONFIG: F021LocalAgentEventBusConfig = {
  featureId: F021_FEATURE_ID,
  stage: F021_STAGE,
  operationCode: F021_OPERATION_CODE,
  contractVersion: F021_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F021LocalAgentEventBusValidationError extends Error {
  public readonly featureId = F021_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F021 Validation Error on '${field}']: ${message}`);
    this.name = "F021LocalAgentEventBusValidationError";
    this.field = field;
  }
}

export function computeF021Digest(rawPayload: string): string {
  return `f021_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F021LocalAgentEventBusEngine {
  private readonly config: F021LocalAgentEventBusConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F021LocalAgentEventBusOutput[] = [];
  private readonly auditLog: F021LocalAgentEventBusAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F021LocalAgentEventBusOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F021LocalAgentEventBusConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F021_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F021LocalAgentEventBusConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F021LocalAgentEventBusInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F021LocalAgentEventBusValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.topic_name).trim().length === 0) {
      throw new F021LocalAgentEventBusValidationError("topic_name", "Primary domain attribute 'topic_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      topic_name: input.topic_name,
      subscriber_count: input.subscriber_count,
      published_event_id: input.published_event_id,
      delivery_latency_ms: input.delivery_latency_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F021LocalAgentEventBusValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F021LocalAgentEventBusInput): F021LocalAgentEventBusOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F021_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        topic_name: input.topic_name,
        subscriber_count: input.subscriber_count,
        published_event_id: input.published_event_id,
        delivery_latency_ms: input.delivery_latency_ms
      });
      const payloadHash = computeF021Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F021LocalAgentEventBusValidationError(
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
        featureId: F021_FEATURE_ID,
        operationCode: F021_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          topic_name: input.topic_name,
          subscriber_count: input.subscriber_count,
          published_event_id: input.published_event_id,
          delivery_latency_ms: input.delivery_latency_ms
        }
      });

      const executionId = `exec_f021_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f021_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F021LocalAgentEventBusAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F021_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `pubsub_bus:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F021LocalAgentEventBusOutput = {
        featureId: F021_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F021_OPERATION_CODE,
        resolved_topic_name: kernelResult.resolvedFields.topic_name as string,
        resolved_subscriber_count: kernelResult.resolvedFields.subscriber_count as string | number,
        resolved_published_event_id: kernelResult.resolvedFields.published_event_id as string | number | boolean | readonly string[],
        resolved_delivery_latency_ms: kernelResult.resolvedFields.delivery_latency_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F021LocalAgentEventBusTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F021_FEATURE_ID,
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

  public getAuditTrail(): readonly F021LocalAgentEventBusAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F021LocalAgentEventBusOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF021Module(): {
  featureId: typeof F021_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F021LocalAgentEventBusEngine();
  const sampleInput: F021LocalAgentEventBusInput = {
    requestId: "req_verify_f021",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    topic_name: "f021_topic_name_seed",
    subscriber_count: 42,
    published_event_id: true,
    delivery_latency_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 21 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F021" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_topic_name !== sampleInput.topic_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F021_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
