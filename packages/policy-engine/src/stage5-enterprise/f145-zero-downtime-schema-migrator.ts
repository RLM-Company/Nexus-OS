/**
 * F145 (stage5-enterprise): Менеджер миграций схемы БД и графа
 * Безопасное накатывание обновлений структуры базы с поддержкой отката без простоя
 * Operation Code: schema_migration_runner
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F145_FEATURE_ID = "F145" as const;
export const F145_STAGE = "stage5-enterprise" as const;
export const F145_OPERATION_CODE = "schema_migration_runner" as const;
export const F145_CONTRACT_VERSION = "2.0.0" as const;

export type F145ZeroDowntimeSchemaMigratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F145ZeroDowntimeSchemaMigratorConfig {
  readonly featureId: typeof F145_FEATURE_ID;
  readonly stage: typeof F145_STAGE;
  readonly operationCode: typeof F145_OPERATION_CODE;
  readonly contractVersion: typeof F145_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F145ZeroDowntimeSchemaMigratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly migration_version: string;
  readonly direction: string | number;
  readonly tables_migrated: string | number | boolean | readonly string[];
  readonly rollback_ready: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F145ZeroDowntimeSchemaMigratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F145_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F145ZeroDowntimeSchemaMigratorOutput {
  readonly featureId: typeof F145_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F145ZeroDowntimeSchemaMigratorExecutionStatus;
  readonly operationCode: typeof F145_OPERATION_CODE;
  readonly resolved_migration_version: string;
  readonly resolved_direction: string | number;
  readonly resolved_tables_migrated: string | number | boolean | readonly string[];
  readonly resolved_rollback_ready: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F145ZeroDowntimeSchemaMigratorAuditEntry;
}

export interface F145ZeroDowntimeSchemaMigratorTelemetrySnapshot {
  readonly featureId: typeof F145_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F145_CONFIG: F145ZeroDowntimeSchemaMigratorConfig = {
  featureId: F145_FEATURE_ID,
  stage: F145_STAGE,
  operationCode: F145_OPERATION_CODE,
  contractVersion: F145_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F145ZeroDowntimeSchemaMigratorValidationError extends Error {
  public readonly featureId = F145_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F145 Validation Error on '${field}']: ${message}`);
    this.name = "F145ZeroDowntimeSchemaMigratorValidationError";
    this.field = field;
  }
}

export function computeF145Digest(rawPayload: string): string {
  return `f145_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F145ZeroDowntimeSchemaMigratorEngine {
  private readonly config: F145ZeroDowntimeSchemaMigratorConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F145ZeroDowntimeSchemaMigratorOutput[] = [];
  private readonly auditLog: F145ZeroDowntimeSchemaMigratorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F145ZeroDowntimeSchemaMigratorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F145ZeroDowntimeSchemaMigratorConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F145_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F145ZeroDowntimeSchemaMigratorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F145ZeroDowntimeSchemaMigratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.migration_version).trim().length === 0) {
      throw new F145ZeroDowntimeSchemaMigratorValidationError("migration_version", "Primary domain attribute 'migration_version' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      migration_version: input.migration_version,
      direction: input.direction,
      tables_migrated: input.tables_migrated,
      rollback_ready: input.rollback_ready
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F145ZeroDowntimeSchemaMigratorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F145ZeroDowntimeSchemaMigratorInput): F145ZeroDowntimeSchemaMigratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F145_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        migration_version: input.migration_version,
        direction: input.direction,
        tables_migrated: input.tables_migrated,
        rollback_ready: input.rollback_ready
      });
      const payloadHash = computeF145Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F145ZeroDowntimeSchemaMigratorValidationError(
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
        featureId: F145_FEATURE_ID,
        operationCode: F145_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          migration_version: input.migration_version,
          direction: input.direction,
          tables_migrated: input.tables_migrated,
          rollback_ready: input.rollback_ready
        }
      });

      const executionId = `exec_f145_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f145_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F145ZeroDowntimeSchemaMigratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F145_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `schema_migration_runner:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F145ZeroDowntimeSchemaMigratorOutput = {
        featureId: F145_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F145_OPERATION_CODE,
        resolved_migration_version: kernelResult.resolvedFields.migration_version as string,
        resolved_direction: kernelResult.resolvedFields.direction as string | number,
        resolved_tables_migrated: kernelResult.resolvedFields.tables_migrated as string | number | boolean | readonly string[],
        resolved_rollback_ready: kernelResult.resolvedFields.rollback_ready as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F145ZeroDowntimeSchemaMigratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F145_FEATURE_ID,
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

  public getAuditTrail(): readonly F145ZeroDowntimeSchemaMigratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F145ZeroDowntimeSchemaMigratorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF145Module(): {
  featureId: typeof F145_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F145ZeroDowntimeSchemaMigratorEngine();
  const sampleInput: F145ZeroDowntimeSchemaMigratorInput = {
    requestId: "req_verify_f145",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    migration_version: "f145_migration_version_seed",
    direction: 42,
    tables_migrated: true,
    rollback_ready: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 145 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F145" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_migration_version !== sampleInput.migration_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F145_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
