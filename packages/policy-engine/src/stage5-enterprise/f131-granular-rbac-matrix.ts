/**
 * F131 (stage5-enterprise): Ролевая модель доступа (RBAC)
 * Гранулярные права: Owner, Admin, Architect, Operator, Viewer на уровне воркспейсов и артефактов
 * Operation Code: rbac_permission_evaluator
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F131_FEATURE_ID = "F131" as const;
export const F131_STAGE = "stage5-enterprise" as const;
export const F131_OPERATION_CODE = "rbac_permission_evaluator" as const;
export const F131_CONTRACT_VERSION = "2.0.0" as const;

export type F131GranularRbacMatrixExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F131GranularRbacMatrixConfig {
  readonly featureId: typeof F131_FEATURE_ID;
  readonly stage: typeof F131_STAGE;
  readonly operationCode: typeof F131_OPERATION_CODE;
  readonly contractVersion: typeof F131_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F131GranularRbacMatrixInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly actor_role: string;
  readonly requested_capability: string | number;
  readonly resource_scope: string | number | boolean | readonly string[];
  readonly verdict_allowed: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F131GranularRbacMatrixAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F131_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F131GranularRbacMatrixOutput {
  readonly featureId: typeof F131_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F131GranularRbacMatrixExecutionStatus;
  readonly operationCode: typeof F131_OPERATION_CODE;
  readonly resolved_actor_role: string;
  readonly resolved_requested_capability: string | number;
  readonly resolved_resource_scope: string | number | boolean | readonly string[];
  readonly resolved_verdict_allowed: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F131GranularRbacMatrixAuditEntry;
}

export interface F131GranularRbacMatrixTelemetrySnapshot {
  readonly featureId: typeof F131_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F131_CONFIG: F131GranularRbacMatrixConfig = {
  featureId: F131_FEATURE_ID,
  stage: F131_STAGE,
  operationCode: F131_OPERATION_CODE,
  contractVersion: F131_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F131GranularRbacMatrixValidationError extends Error {
  public readonly featureId = F131_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F131 Validation Error on '${field}']: ${message}`);
    this.name = "F131GranularRbacMatrixValidationError";
    this.field = field;
  }
}

export function computeF131Digest(rawPayload: string): string {
  return `f131_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F131GranularRbacMatrixEngine {
  private readonly config: F131GranularRbacMatrixConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F131GranularRbacMatrixOutput[] = [];
  private readonly auditLog: F131GranularRbacMatrixAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F131GranularRbacMatrixOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F131GranularRbacMatrixConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F131_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F131GranularRbacMatrixConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F131GranularRbacMatrixInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F131GranularRbacMatrixValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.actor_role).trim().length === 0) {
      throw new F131GranularRbacMatrixValidationError("actor_role", "Primary domain attribute 'actor_role' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      actor_role: input.actor_role,
      requested_capability: input.requested_capability,
      resource_scope: input.resource_scope,
      verdict_allowed: input.verdict_allowed
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F131GranularRbacMatrixValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F131GranularRbacMatrixInput): F131GranularRbacMatrixOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F131_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        actor_role: input.actor_role,
        requested_capability: input.requested_capability,
        resource_scope: input.resource_scope,
        verdict_allowed: input.verdict_allowed
      });
      const payloadHash = computeF131Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F131GranularRbacMatrixValidationError(
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
        featureId: F131_FEATURE_ID,
        operationCode: F131_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          actor_role: input.actor_role,
          requested_capability: input.requested_capability,
          resource_scope: input.resource_scope,
          verdict_allowed: input.verdict_allowed
        }
      });

      const executionId = `exec_f131_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f131_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F131GranularRbacMatrixAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F131_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `rbac_permission_evaluator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F131GranularRbacMatrixOutput = {
        featureId: F131_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F131_OPERATION_CODE,
        resolved_actor_role: kernelResult.resolvedFields.actor_role as string,
        resolved_requested_capability: kernelResult.resolvedFields.requested_capability as string | number,
        resolved_resource_scope: kernelResult.resolvedFields.resource_scope as string | number | boolean | readonly string[],
        resolved_verdict_allowed: kernelResult.resolvedFields.verdict_allowed as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F131GranularRbacMatrixTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F131_FEATURE_ID,
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

  public getAuditTrail(): readonly F131GranularRbacMatrixAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F131GranularRbacMatrixOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF131Module(): {
  featureId: typeof F131_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F131GranularRbacMatrixEngine();
  const sampleInput: F131GranularRbacMatrixInput = {
    requestId: "req_verify_f131",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    actor_role: "f131_actor_role_seed",
    requested_capability: 42,
    resource_scope: true,
    verdict_allowed: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 131 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F131" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_actor_role !== sampleInput.actor_role &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F131_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
