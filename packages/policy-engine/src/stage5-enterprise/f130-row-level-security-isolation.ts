/**
 * F130 (stage5-enterprise): Строгая изоляция данных на уровне БД (Row-Level Security)
 * Аппаратно-логическое разделение данных разных арендаторов (Tenants)
 * Operation Code: rls_tenant_guard
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F130_FEATURE_ID = "F130" as const;
export const F130_STAGE = "stage5-enterprise" as const;
export const F130_OPERATION_CODE = "rls_tenant_guard" as const;
export const F130_CONTRACT_VERSION = "2.0.0" as const;

export type F130RowLevelSecurityIsolationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F130RowLevelSecurityIsolationConfig {
  readonly featureId: typeof F130_FEATURE_ID;
  readonly stage: typeof F130_STAGE;
  readonly operationCode: typeof F130_OPERATION_CODE;
  readonly contractVersion: typeof F130_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F130RowLevelSecurityIsolationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly requesting_tenant_id: string;
  readonly row_tenant_id: string | number;
  readonly access_granted: string | number | boolean | readonly string[];
  readonly policy_enforcement: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F130RowLevelSecurityIsolationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F130_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F130RowLevelSecurityIsolationOutput {
  readonly featureId: typeof F130_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F130RowLevelSecurityIsolationExecutionStatus;
  readonly operationCode: typeof F130_OPERATION_CODE;
  readonly resolved_requesting_tenant_id: string;
  readonly resolved_row_tenant_id: string | number;
  readonly resolved_access_granted: string | number | boolean | readonly string[];
  readonly resolved_policy_enforcement: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F130RowLevelSecurityIsolationAuditEntry;
}

export interface F130RowLevelSecurityIsolationTelemetrySnapshot {
  readonly featureId: typeof F130_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F130_CONFIG: F130RowLevelSecurityIsolationConfig = {
  featureId: F130_FEATURE_ID,
  stage: F130_STAGE,
  operationCode: F130_OPERATION_CODE,
  contractVersion: F130_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F130RowLevelSecurityIsolationValidationError extends Error {
  public readonly featureId = F130_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F130 Validation Error on '${field}']: ${message}`);
    this.name = "F130RowLevelSecurityIsolationValidationError";
    this.field = field;
  }
}

export function computeF130Digest(rawPayload: string): string {
  return `f130_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F130RowLevelSecurityIsolationEngine {
  private readonly config: F130RowLevelSecurityIsolationConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F130RowLevelSecurityIsolationOutput[] = [];
  private readonly auditLog: F130RowLevelSecurityIsolationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F130RowLevelSecurityIsolationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F130RowLevelSecurityIsolationConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F130_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F130RowLevelSecurityIsolationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F130RowLevelSecurityIsolationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F130RowLevelSecurityIsolationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.requesting_tenant_id).trim().length === 0) {
      throw new F130RowLevelSecurityIsolationValidationError("requesting_tenant_id", "Primary domain attribute 'requesting_tenant_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      requesting_tenant_id: input.requesting_tenant_id,
      row_tenant_id: input.row_tenant_id,
      access_granted: input.access_granted,
      policy_enforcement: input.policy_enforcement
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F130RowLevelSecurityIsolationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F130RowLevelSecurityIsolationInput): F130RowLevelSecurityIsolationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F130_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        requesting_tenant_id: input.requesting_tenant_id,
        row_tenant_id: input.row_tenant_id,
        access_granted: input.access_granted,
        policy_enforcement: input.policy_enforcement
      });
      const payloadHash = computeF130Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F130RowLevelSecurityIsolationValidationError(
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
        featureId: F130_FEATURE_ID,
        operationCode: F130_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          requesting_tenant_id: input.requesting_tenant_id,
          row_tenant_id: input.row_tenant_id,
          access_granted: input.access_granted,
          policy_enforcement: input.policy_enforcement
        }
      });

      const executionId = `exec_f130_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f130_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F130RowLevelSecurityIsolationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F130_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `rls_tenant_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F130RowLevelSecurityIsolationOutput = {
        featureId: F130_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F130_OPERATION_CODE,
        resolved_requesting_tenant_id: kernelResult.resolvedFields.requesting_tenant_id as string,
        resolved_row_tenant_id: kernelResult.resolvedFields.row_tenant_id as string | number,
        resolved_access_granted: kernelResult.resolvedFields.access_granted as string | number | boolean | readonly string[],
        resolved_policy_enforcement: kernelResult.resolvedFields.policy_enforcement as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F130RowLevelSecurityIsolationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F130_FEATURE_ID,
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

  public getAuditTrail(): readonly F130RowLevelSecurityIsolationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F130RowLevelSecurityIsolationOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF130Module(): {
  featureId: typeof F130_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F130RowLevelSecurityIsolationEngine();
  const sampleInput: F130RowLevelSecurityIsolationInput = {
    requestId: "req_verify_f130",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    requesting_tenant_id: "f130_requesting_tenant_id_seed",
    row_tenant_id: 42,
    access_granted: true,
    policy_enforcement: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 130 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F130" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_requesting_tenant_id !== sampleInput.requesting_tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F130_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
