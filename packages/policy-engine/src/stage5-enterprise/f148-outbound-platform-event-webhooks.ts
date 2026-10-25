/**
 * F148 (stage5-enterprise): Вебхуки событий платформы для внешних систем
 * Отправка уведомлений в корпоративные шины при готовности отчёта или падении графа
 * Operation Code: webhook_dispatcher
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F148_FEATURE_ID = "F148" as const;
export const F148_STAGE = "stage5-enterprise" as const;
export const F148_OPERATION_CODE = "webhook_dispatcher" as const;
export const F148_CONTRACT_VERSION = "2.0.0" as const;

export type F148OutboundPlatformEventWebhooksExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F148OutboundPlatformEventWebhooksConfig {
  readonly featureId: typeof F148_FEATURE_ID;
  readonly stage: typeof F148_STAGE;
  readonly operationCode: typeof F148_OPERATION_CODE;
  readonly contractVersion: typeof F148_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F148OutboundPlatformEventWebhooksInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly webhook_id: string;
  readonly event_topic: string | number;
  readonly hmac_signature: string | number | boolean | readonly string[];
  readonly delivery_http_status: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F148OutboundPlatformEventWebhooksAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F148_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F148OutboundPlatformEventWebhooksOutput {
  readonly featureId: typeof F148_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F148OutboundPlatformEventWebhooksExecutionStatus;
  readonly operationCode: typeof F148_OPERATION_CODE;
  readonly resolved_webhook_id: string;
  readonly resolved_event_topic: string | number;
  readonly resolved_hmac_signature: string | number | boolean | readonly string[];
  readonly resolved_delivery_http_status: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F148OutboundPlatformEventWebhooksAuditEntry;
}

export interface F148OutboundPlatformEventWebhooksTelemetrySnapshot {
  readonly featureId: typeof F148_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F148_CONFIG: F148OutboundPlatformEventWebhooksConfig = {
  featureId: F148_FEATURE_ID,
  stage: F148_STAGE,
  operationCode: F148_OPERATION_CODE,
  contractVersion: F148_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F148OutboundPlatformEventWebhooksValidationError extends Error {
  public readonly featureId = F148_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F148 Validation Error on '${field}']: ${message}`);
    this.name = "F148OutboundPlatformEventWebhooksValidationError";
    this.field = field;
  }
}

export function computeF148Digest(rawPayload: string): string {
  return `f148_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F148OutboundPlatformEventWebhooksEngine {
  private readonly config: F148OutboundPlatformEventWebhooksConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F148OutboundPlatformEventWebhooksOutput[] = [];
  private readonly auditLog: F148OutboundPlatformEventWebhooksAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F148OutboundPlatformEventWebhooksOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F148OutboundPlatformEventWebhooksConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F148_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F148OutboundPlatformEventWebhooksConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F148OutboundPlatformEventWebhooksInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F148OutboundPlatformEventWebhooksValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.webhook_id).trim().length === 0) {
      throw new F148OutboundPlatformEventWebhooksValidationError("webhook_id", "Primary domain attribute 'webhook_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      webhook_id: input.webhook_id,
      event_topic: input.event_topic,
      hmac_signature: input.hmac_signature,
      delivery_http_status: input.delivery_http_status
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F148OutboundPlatformEventWebhooksValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F148OutboundPlatformEventWebhooksInput): F148OutboundPlatformEventWebhooksOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F148_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        webhook_id: input.webhook_id,
        event_topic: input.event_topic,
        hmac_signature: input.hmac_signature,
        delivery_http_status: input.delivery_http_status
      });
      const payloadHash = computeF148Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F148OutboundPlatformEventWebhooksValidationError(
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
        featureId: F148_FEATURE_ID,
        operationCode: F148_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          webhook_id: input.webhook_id,
          event_topic: input.event_topic,
          hmac_signature: input.hmac_signature,
          delivery_http_status: input.delivery_http_status
        }
      });

      const executionId = `exec_f148_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f148_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F148OutboundPlatformEventWebhooksAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F148_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `webhook_dispatcher:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F148OutboundPlatformEventWebhooksOutput = {
        featureId: F148_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F148_OPERATION_CODE,
        resolved_webhook_id: kernelResult.resolvedFields.webhook_id as string,
        resolved_event_topic: kernelResult.resolvedFields.event_topic as string | number,
        resolved_hmac_signature: kernelResult.resolvedFields.hmac_signature as string | number | boolean | readonly string[],
        resolved_delivery_http_status: kernelResult.resolvedFields.delivery_http_status as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F148OutboundPlatformEventWebhooksTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F148_FEATURE_ID,
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

  public getAuditTrail(): readonly F148OutboundPlatformEventWebhooksAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F148OutboundPlatformEventWebhooksOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF148Module(): {
  featureId: typeof F148_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F148OutboundPlatformEventWebhooksEngine();
  const sampleInput: F148OutboundPlatformEventWebhooksInput = {
    requestId: "req_verify_f148",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    webhook_id: "f148_webhook_id_seed",
    event_topic: 42,
    hmac_signature: true,
    delivery_http_status: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 148 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F148" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_webhook_id !== sampleInput.webhook_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F148_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
