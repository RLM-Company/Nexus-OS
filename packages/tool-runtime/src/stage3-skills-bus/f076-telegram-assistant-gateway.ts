/**
 * F076 (stage3-skills-bus): Шлюз Telegram-ассистента
 * Управление задачами Nexus-OS, получение уведомлений и аппрув чекпоинтов через Telegram
 * Operation Code: telegram_bot_bridge
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F076_FEATURE_ID = "F076" as const;
export const F076_STAGE = "stage3-skills-bus" as const;
export const F076_OPERATION_CODE = "telegram_bot_bridge" as const;
export const F076_CONTRACT_VERSION = "2.0.0" as const;

export type F076TelegramAssistantGatewayExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F076TelegramAssistantGatewayConfig {
  readonly featureId: typeof F076_FEATURE_ID;
  readonly stage: typeof F076_STAGE;
  readonly operationCode: typeof F076_OPERATION_CODE;
  readonly contractVersion: typeof F076_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F076TelegramAssistantGatewayInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly chat_id: string;
  readonly notification_kind: string | number;
  readonly inline_approval_callback: string | number | boolean | readonly string[];
  readonly delivered_ok: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F076TelegramAssistantGatewayAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F076_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F076TelegramAssistantGatewayOutput {
  readonly featureId: typeof F076_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F076TelegramAssistantGatewayExecutionStatus;
  readonly operationCode: typeof F076_OPERATION_CODE;
  readonly resolved_chat_id: string;
  readonly resolved_notification_kind: string | number;
  readonly resolved_inline_approval_callback: string | number | boolean | readonly string[];
  readonly resolved_delivered_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F076TelegramAssistantGatewayAuditEntry;
}

export interface F076TelegramAssistantGatewayTelemetrySnapshot {
  readonly featureId: typeof F076_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F076_CONFIG: F076TelegramAssistantGatewayConfig = {
  featureId: F076_FEATURE_ID,
  stage: F076_STAGE,
  operationCode: F076_OPERATION_CODE,
  contractVersion: F076_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F076TelegramAssistantGatewayValidationError extends Error {
  public readonly featureId = F076_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F076 Validation Error on '${field}']: ${message}`);
    this.name = "F076TelegramAssistantGatewayValidationError";
    this.field = field;
  }
}

export function computeF076Digest(rawPayload: string): string {
  return `f076_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F076TelegramAssistantGatewayEngine {
  private readonly config: F076TelegramAssistantGatewayConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F076TelegramAssistantGatewayOutput[] = [];
  private readonly auditLog: F076TelegramAssistantGatewayAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F076TelegramAssistantGatewayOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F076TelegramAssistantGatewayConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F076_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F076TelegramAssistantGatewayConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F076TelegramAssistantGatewayInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F076TelegramAssistantGatewayValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.chat_id).trim().length === 0) {
      throw new F076TelegramAssistantGatewayValidationError("chat_id", "Primary domain attribute 'chat_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      chat_id: input.chat_id,
      notification_kind: input.notification_kind,
      inline_approval_callback: input.inline_approval_callback,
      delivered_ok: input.delivered_ok
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F076TelegramAssistantGatewayValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F076TelegramAssistantGatewayInput): F076TelegramAssistantGatewayOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F076_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        chat_id: input.chat_id,
        notification_kind: input.notification_kind,
        inline_approval_callback: input.inline_approval_callback,
        delivered_ok: input.delivered_ok
      });
      const payloadHash = computeF076Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F076TelegramAssistantGatewayValidationError(
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
        featureId: F076_FEATURE_ID,
        operationCode: F076_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          chat_id: input.chat_id,
          notification_kind: input.notification_kind,
          inline_approval_callback: input.inline_approval_callback,
          delivered_ok: input.delivered_ok
        }
      });

      const executionId = `exec_f076_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f076_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F076TelegramAssistantGatewayAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F076_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `telegram_bot_bridge:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F076TelegramAssistantGatewayOutput = {
        featureId: F076_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F076_OPERATION_CODE,
        resolved_chat_id: kernelResult.resolvedFields.chat_id as string,
        resolved_notification_kind: kernelResult.resolvedFields.notification_kind as string | number,
        resolved_inline_approval_callback: kernelResult.resolvedFields.inline_approval_callback as string | number | boolean | readonly string[],
        resolved_delivered_ok: kernelResult.resolvedFields.delivered_ok as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F076TelegramAssistantGatewayTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F076_FEATURE_ID,
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

  public getAuditTrail(): readonly F076TelegramAssistantGatewayAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F076TelegramAssistantGatewayOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF076Module(): {
  featureId: typeof F076_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F076TelegramAssistantGatewayEngine();
  const sampleInput: F076TelegramAssistantGatewayInput = {
    requestId: "req_verify_f076",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    chat_id: "f076_chat_id_seed",
    notification_kind: 42,
    inline_approval_callback: true,
    delivered_ok: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 76 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F076" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_chat_id !== sampleInput.chat_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F076_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
