/**
 * F092 (stage3-skills-bus): Привязка учётных записей с разделением скоупов (Account Connectors)
 * Безопасное хранение токенов GitHub, облачных дисков и мессенджеров
 * Operation Code: scoped_connector_vault
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F092_FEATURE_ID = "F092" as const;
export const F092_STAGE = "stage3-skills-bus" as const;
export const F092_OPERATION_CODE = "scoped_connector_vault" as const;
export const F092_CONTRACT_VERSION = "2.0.0" as const;

export type F092ScopedAccountConnectorsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F092ScopedAccountConnectorsConfig {
  readonly featureId: typeof F092_FEATURE_ID;
  readonly stage: typeof F092_STAGE;
  readonly operationCode: typeof F092_OPERATION_CODE;
  readonly contractVersion: typeof F092_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F092ScopedAccountConnectorsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly connector_id: string;
  readonly provider_name: string | number;
  readonly granted_scopes: string | number | boolean | readonly string[];
  readonly least_privilege_ok: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F092ScopedAccountConnectorsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F092_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F092ScopedAccountConnectorsOutput {
  readonly featureId: typeof F092_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F092ScopedAccountConnectorsExecutionStatus;
  readonly operationCode: typeof F092_OPERATION_CODE;
  readonly resolved_connector_id: string;
  readonly resolved_provider_name: string | number;
  readonly resolved_granted_scopes: string | number | boolean | readonly string[];
  readonly resolved_least_privilege_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F092ScopedAccountConnectorsAuditEntry;
}

export interface F092ScopedAccountConnectorsTelemetrySnapshot {
  readonly featureId: typeof F092_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F092_CONFIG: F092ScopedAccountConnectorsConfig = {
  featureId: F092_FEATURE_ID,
  stage: F092_STAGE,
  operationCode: F092_OPERATION_CODE,
  contractVersion: F092_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F092ScopedAccountConnectorsValidationError extends Error {
  public readonly featureId = F092_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F092 Validation Error on '${field}']: ${message}`);
    this.name = "F092ScopedAccountConnectorsValidationError";
    this.field = field;
  }
}

export function computeF092Digest(rawPayload: string): string {
  return `f092_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F092ScopedAccountConnectorsEngine {
  private readonly config: F092ScopedAccountConnectorsConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F092ScopedAccountConnectorsOutput[] = [];
  private readonly auditLog: F092ScopedAccountConnectorsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F092ScopedAccountConnectorsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F092ScopedAccountConnectorsConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F092_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F092ScopedAccountConnectorsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F092ScopedAccountConnectorsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F092ScopedAccountConnectorsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.connector_id).trim().length === 0) {
      throw new F092ScopedAccountConnectorsValidationError("connector_id", "Primary domain attribute 'connector_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      connector_id: input.connector_id,
      provider_name: input.provider_name,
      granted_scopes: input.granted_scopes,
      least_privilege_ok: input.least_privilege_ok
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F092ScopedAccountConnectorsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F092ScopedAccountConnectorsInput): F092ScopedAccountConnectorsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F092_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        connector_id: input.connector_id,
        provider_name: input.provider_name,
        granted_scopes: input.granted_scopes,
        least_privilege_ok: input.least_privilege_ok
      });
      const payloadHash = computeF092Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F092ScopedAccountConnectorsValidationError(
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
        featureId: F092_FEATURE_ID,
        operationCode: F092_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          connector_id: input.connector_id,
          provider_name: input.provider_name,
          granted_scopes: input.granted_scopes,
          least_privilege_ok: input.least_privilege_ok
        }
      });

      const executionId = `exec_f092_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f092_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F092ScopedAccountConnectorsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F092_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `scoped_connector_vault:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F092ScopedAccountConnectorsOutput = {
        featureId: F092_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F092_OPERATION_CODE,
        resolved_connector_id: kernelResult.resolvedFields.connector_id as string,
        resolved_provider_name: kernelResult.resolvedFields.provider_name as string | number,
        resolved_granted_scopes: kernelResult.resolvedFields.granted_scopes as string | number | boolean | readonly string[],
        resolved_least_privilege_ok: kernelResult.resolvedFields.least_privilege_ok as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F092ScopedAccountConnectorsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F092_FEATURE_ID,
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

  public getAuditTrail(): readonly F092ScopedAccountConnectorsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F092ScopedAccountConnectorsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF092Module(): {
  featureId: typeof F092_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F092ScopedAccountConnectorsEngine();
  const sampleInput: F092ScopedAccountConnectorsInput = {
    requestId: "req_verify_f092",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    connector_id: "f092_connector_id_seed",
    provider_name: 42,
    granted_scopes: true,
    least_privilege_ok: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 92 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F092" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_connector_id !== sampleInput.connector_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F092_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
