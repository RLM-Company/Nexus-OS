/**
 * F079 (stage3-skills-bus): Песочница исходящих Webhook и REST API вызовов
 * Подключение внешних сервисов по OpenAPI/Swagger-спецификации
 * Operation Code: openapi_rest_caller
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F079_FEATURE_ID = "F079" as const;
export const F079_STAGE = "stage3-skills-bus" as const;
export const F079_OPERATION_CODE = "openapi_rest_caller" as const;
export const F079_CONTRACT_VERSION = "2.0.0" as const;

export type F079OpenapiWebhookRestSandboxExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F079OpenapiWebhookRestSandboxConfig {
  readonly featureId: typeof F079_FEATURE_ID;
  readonly stage: typeof F079_STAGE;
  readonly operationCode: typeof F079_OPERATION_CODE;
  readonly contractVersion: typeof F079_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F079OpenapiWebhookRestSandboxInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly operation_id: string;
  readonly endpoint_url: string | number;
  readonly http_method: string | number | boolean | readonly string[];
  readonly response_status: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F079OpenapiWebhookRestSandboxAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F079_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F079OpenapiWebhookRestSandboxOutput {
  readonly featureId: typeof F079_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F079OpenapiWebhookRestSandboxExecutionStatus;
  readonly operationCode: typeof F079_OPERATION_CODE;
  readonly resolved_operation_id: string;
  readonly resolved_endpoint_url: string | number;
  readonly resolved_http_method: string | number | boolean | readonly string[];
  readonly resolved_response_status: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F079OpenapiWebhookRestSandboxAuditEntry;
}

export interface F079OpenapiWebhookRestSandboxTelemetrySnapshot {
  readonly featureId: typeof F079_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F079_CONFIG: F079OpenapiWebhookRestSandboxConfig = {
  featureId: F079_FEATURE_ID,
  stage: F079_STAGE,
  operationCode: F079_OPERATION_CODE,
  contractVersion: F079_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F079OpenapiWebhookRestSandboxValidationError extends Error {
  public readonly featureId = F079_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F079 Validation Error on '${field}']: ${message}`);
    this.name = "F079OpenapiWebhookRestSandboxValidationError";
    this.field = field;
  }
}

export function computeF079Digest(rawPayload: string): string {
  return `f079_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F079OpenapiWebhookRestSandboxEngine {
  private readonly config: F079OpenapiWebhookRestSandboxConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F079OpenapiWebhookRestSandboxOutput[] = [];
  private readonly auditLog: F079OpenapiWebhookRestSandboxAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F079OpenapiWebhookRestSandboxOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F079OpenapiWebhookRestSandboxConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F079_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F079OpenapiWebhookRestSandboxConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F079OpenapiWebhookRestSandboxInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F079OpenapiWebhookRestSandboxValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.operation_id).trim().length === 0) {
      throw new F079OpenapiWebhookRestSandboxValidationError("operation_id", "Primary domain attribute 'operation_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      operation_id: input.operation_id,
      endpoint_url: input.endpoint_url,
      http_method: input.http_method,
      response_status: input.response_status
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F079OpenapiWebhookRestSandboxValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F079OpenapiWebhookRestSandboxInput): F079OpenapiWebhookRestSandboxOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F079_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        operation_id: input.operation_id,
        endpoint_url: input.endpoint_url,
        http_method: input.http_method,
        response_status: input.response_status
      });
      const payloadHash = computeF079Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F079OpenapiWebhookRestSandboxValidationError(
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
        featureId: F079_FEATURE_ID,
        operationCode: F079_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          operation_id: input.operation_id,
          endpoint_url: input.endpoint_url,
          http_method: input.http_method,
          response_status: input.response_status
        }
      });

      const executionId = `exec_f079_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f079_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F079OpenapiWebhookRestSandboxAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F079_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `openapi_rest_caller:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F079OpenapiWebhookRestSandboxOutput = {
        featureId: F079_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F079_OPERATION_CODE,
        resolved_operation_id: kernelResult.resolvedFields.operation_id as string,
        resolved_endpoint_url: kernelResult.resolvedFields.endpoint_url as string | number,
        resolved_http_method: kernelResult.resolvedFields.http_method as string | number | boolean | readonly string[],
        resolved_response_status: kernelResult.resolvedFields.response_status as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F079OpenapiWebhookRestSandboxTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F079_FEATURE_ID,
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

  public getAuditTrail(): readonly F079OpenapiWebhookRestSandboxAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F079OpenapiWebhookRestSandboxOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF079Module(): {
  featureId: typeof F079_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F079OpenapiWebhookRestSandboxEngine();
  const sampleInput: F079OpenapiWebhookRestSandboxInput = {
    requestId: "req_verify_f079",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    operation_id: "f079_operation_id_seed",
    endpoint_url: 42,
    http_method: true,
    response_status: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 79 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F079" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_operation_id !== sampleInput.operation_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F079_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
