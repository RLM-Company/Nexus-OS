/**
 * F129 (stage5-enterprise): Мультитенантная архитектура («Цифровая холдинговая компания»)
 * Управление независимыми организациями, департаментами и проектами из единого мастер-аккаунта
 * Operation Code: holding_hierarchy_manager
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F129_FEATURE_ID = "F129" as const;
export const F129_STAGE = "stage5-enterprise" as const;
export const F129_OPERATION_CODE = "holding_hierarchy_manager" as const;
export const F129_CONTRACT_VERSION = "2.0.0" as const;

export type F129MultitenantDigitalHoldingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F129MultitenantDigitalHoldingConfig {
  readonly featureId: typeof F129_FEATURE_ID;
  readonly stage: typeof F129_STAGE;
  readonly operationCode: typeof F129_OPERATION_CODE;
  readonly contractVersion: typeof F129_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F129MultitenantDigitalHoldingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly holding_id: string;
  readonly subsidiary_tenant_ids: string | number;
  readonly consolidated_governance: string | number | boolean | readonly string[];
  readonly isolation_mode: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F129MultitenantDigitalHoldingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F129_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F129MultitenantDigitalHoldingOutput {
  readonly featureId: typeof F129_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F129MultitenantDigitalHoldingExecutionStatus;
  readonly operationCode: typeof F129_OPERATION_CODE;
  readonly resolved_holding_id: string;
  readonly resolved_subsidiary_tenant_ids: string | number;
  readonly resolved_consolidated_governance: string | number | boolean | readonly string[];
  readonly resolved_isolation_mode: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F129MultitenantDigitalHoldingAuditEntry;
}

export interface F129MultitenantDigitalHoldingTelemetrySnapshot {
  readonly featureId: typeof F129_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F129_CONFIG: F129MultitenantDigitalHoldingConfig = {
  featureId: F129_FEATURE_ID,
  stage: F129_STAGE,
  operationCode: F129_OPERATION_CODE,
  contractVersion: F129_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F129MultitenantDigitalHoldingValidationError extends Error {
  public readonly featureId = F129_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F129 Validation Error on '${field}']: ${message}`);
    this.name = "F129MultitenantDigitalHoldingValidationError";
    this.field = field;
  }
}

export function computeF129Digest(rawPayload: string): string {
  return `f129_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F129MultitenantDigitalHoldingEngine {
  private readonly config: F129MultitenantDigitalHoldingConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F129MultitenantDigitalHoldingOutput[] = [];
  private readonly auditLog: F129MultitenantDigitalHoldingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F129MultitenantDigitalHoldingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F129MultitenantDigitalHoldingConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F129_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F129MultitenantDigitalHoldingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F129MultitenantDigitalHoldingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F129MultitenantDigitalHoldingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.holding_id).trim().length === 0) {
      throw new F129MultitenantDigitalHoldingValidationError("holding_id", "Primary domain attribute 'holding_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      holding_id: input.holding_id,
      subsidiary_tenant_ids: input.subsidiary_tenant_ids,
      consolidated_governance: input.consolidated_governance,
      isolation_mode: input.isolation_mode
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F129MultitenantDigitalHoldingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F129MultitenantDigitalHoldingInput): F129MultitenantDigitalHoldingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F129_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        holding_id: input.holding_id,
        subsidiary_tenant_ids: input.subsidiary_tenant_ids,
        consolidated_governance: input.consolidated_governance,
        isolation_mode: input.isolation_mode
      });
      const payloadHash = computeF129Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F129MultitenantDigitalHoldingValidationError(
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
        featureId: F129_FEATURE_ID,
        operationCode: F129_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          holding_id: input.holding_id,
          subsidiary_tenant_ids: input.subsidiary_tenant_ids,
          consolidated_governance: input.consolidated_governance,
          isolation_mode: input.isolation_mode
        }
      });

      const executionId = `exec_f129_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f129_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F129MultitenantDigitalHoldingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F129_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `holding_hierarchy_manager:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F129MultitenantDigitalHoldingOutput = {
        featureId: F129_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F129_OPERATION_CODE,
        resolved_holding_id: kernelResult.resolvedFields.holding_id as string,
        resolved_subsidiary_tenant_ids: kernelResult.resolvedFields.subsidiary_tenant_ids as string | number,
        resolved_consolidated_governance: kernelResult.resolvedFields.consolidated_governance as string | number | boolean | readonly string[],
        resolved_isolation_mode: kernelResult.resolvedFields.isolation_mode as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F129MultitenantDigitalHoldingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F129_FEATURE_ID,
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

  public getAuditTrail(): readonly F129MultitenantDigitalHoldingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F129MultitenantDigitalHoldingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF129Module(): {
  featureId: typeof F129_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F129MultitenantDigitalHoldingEngine();
  const sampleInput: F129MultitenantDigitalHoldingInput = {
    requestId: "req_verify_f129",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    holding_id: "f129_holding_id_seed",
    subsidiary_tenant_ids: 42,
    consolidated_governance: true,
    isolation_mode: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 129 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F129" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_holding_id !== sampleInput.holding_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F129_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
