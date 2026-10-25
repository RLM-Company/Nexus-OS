/**
 * F138 (stage5-enterprise): Биллинг и учёт расхода токенов по тенантам
 * Детальная разбивка стоимости запросов по проектам, пользователям и моделям
 * Operation Code: tenant_usage_metering
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F138_FEATURE_ID = "F138" as const;
export const F138_STAGE = "stage5-enterprise" as const;
export const F138_OPERATION_CODE = "tenant_usage_metering" as const;
export const F138_CONTRACT_VERSION = "2.0.0" as const;

export type F138TenantTokenBillingLedgerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F138TenantTokenBillingLedgerConfig {
  readonly featureId: typeof F138_FEATURE_ID;
  readonly stage: typeof F138_STAGE;
  readonly operationCode: typeof F138_OPERATION_CODE;
  readonly contractVersion: typeof F138_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F138TenantTokenBillingLedgerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tenant_id: string;
  readonly prompt_tokens: string | number;
  readonly completion_tokens: string | number | boolean | readonly string[];
  readonly accrued_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F138TenantTokenBillingLedgerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F138_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F138TenantTokenBillingLedgerOutput {
  readonly featureId: typeof F138_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F138TenantTokenBillingLedgerExecutionStatus;
  readonly operationCode: typeof F138_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_prompt_tokens: string | number;
  readonly resolved_completion_tokens: string | number | boolean | readonly string[];
  readonly resolved_accrued_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F138TenantTokenBillingLedgerAuditEntry;
}

export interface F138TenantTokenBillingLedgerTelemetrySnapshot {
  readonly featureId: typeof F138_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F138_CONFIG: F138TenantTokenBillingLedgerConfig = {
  featureId: F138_FEATURE_ID,
  stage: F138_STAGE,
  operationCode: F138_OPERATION_CODE,
  contractVersion: F138_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F138TenantTokenBillingLedgerValidationError extends Error {
  public readonly featureId = F138_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F138 Validation Error on '${field}']: ${message}`);
    this.name = "F138TenantTokenBillingLedgerValidationError";
    this.field = field;
  }
}

export function computeF138Digest(rawPayload: string): string {
  return `f138_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F138TenantTokenBillingLedgerEngine {
  private readonly config: F138TenantTokenBillingLedgerConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F138TenantTokenBillingLedgerOutput[] = [];
  private readonly auditLog: F138TenantTokenBillingLedgerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F138TenantTokenBillingLedgerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F138TenantTokenBillingLedgerConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F138_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F138TenantTokenBillingLedgerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F138TenantTokenBillingLedgerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F138TenantTokenBillingLedgerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.tenant_id).trim().length === 0) {
      throw new F138TenantTokenBillingLedgerValidationError("tenant_id", "Primary domain attribute 'tenant_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      tenant_id: input.tenant_id,
      prompt_tokens: input.prompt_tokens,
      completion_tokens: input.completion_tokens,
      accrued_cost_usd: input.accrued_cost_usd
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F138TenantTokenBillingLedgerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F138TenantTokenBillingLedgerInput): F138TenantTokenBillingLedgerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F138_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        tenant_id: input.tenant_id,
        prompt_tokens: input.prompt_tokens,
        completion_tokens: input.completion_tokens,
        accrued_cost_usd: input.accrued_cost_usd
      });
      const payloadHash = computeF138Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F138TenantTokenBillingLedgerValidationError(
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
        featureId: F138_FEATURE_ID,
        operationCode: F138_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          tenant_id: input.tenant_id,
          prompt_tokens: input.prompt_tokens,
          completion_tokens: input.completion_tokens,
          accrued_cost_usd: input.accrued_cost_usd
        }
      });

      const executionId = `exec_f138_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f138_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F138TenantTokenBillingLedgerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F138_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tenant_usage_metering:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F138TenantTokenBillingLedgerOutput = {
        featureId: F138_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F138_OPERATION_CODE,
        resolved_tenant_id: kernelResult.resolvedFields.tenant_id as string,
        resolved_prompt_tokens: kernelResult.resolvedFields.prompt_tokens as string | number,
        resolved_completion_tokens: kernelResult.resolvedFields.completion_tokens as string | number | boolean | readonly string[],
        resolved_accrued_cost_usd: kernelResult.resolvedFields.accrued_cost_usd as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F138TenantTokenBillingLedgerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F138_FEATURE_ID,
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

  public getAuditTrail(): readonly F138TenantTokenBillingLedgerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F138TenantTokenBillingLedgerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF138Module(): {
  featureId: typeof F138_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F138TenantTokenBillingLedgerEngine();
  const sampleInput: F138TenantTokenBillingLedgerInput = {
    requestId: "req_verify_f138",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f138_tenant_id_seed",
    prompt_tokens: 42,
    completion_tokens: true,
    accrued_cost_usd: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 138 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F138" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F138_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
