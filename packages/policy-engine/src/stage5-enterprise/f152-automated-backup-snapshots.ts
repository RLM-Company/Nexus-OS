/**
 * F152 (stage5-enterprise): Автоматическое резервное копирование и снапшоты
 * Ежедневный бэкап графов знаний, чатов и версий Canvas с восстановлением в один клик
 * Operation Code: snapshot_backup_engine
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F152_FEATURE_ID = "F152" as const;
export const F152_STAGE = "stage5-enterprise" as const;
export const F152_OPERATION_CODE = "snapshot_backup_engine" as const;
export const F152_CONTRACT_VERSION = "2.0.0" as const;

export type F152AutomatedBackupSnapshotsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F152AutomatedBackupSnapshotsConfig {
  readonly featureId: typeof F152_FEATURE_ID;
  readonly stage: typeof F152_STAGE;
  readonly operationCode: typeof F152_OPERATION_CODE;
  readonly contractVersion: typeof F152_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F152AutomatedBackupSnapshotsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly snapshot_id: string;
  readonly included_graphs: string | number;
  readonly included_canvas_tabs: string | number | boolean | readonly string[];
  readonly one_click_restorable: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F152AutomatedBackupSnapshotsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F152_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F152AutomatedBackupSnapshotsOutput {
  readonly featureId: typeof F152_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F152AutomatedBackupSnapshotsExecutionStatus;
  readonly operationCode: typeof F152_OPERATION_CODE;
  readonly resolved_snapshot_id: string;
  readonly resolved_included_graphs: string | number;
  readonly resolved_included_canvas_tabs: string | number | boolean | readonly string[];
  readonly resolved_one_click_restorable: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F152AutomatedBackupSnapshotsAuditEntry;
}

export interface F152AutomatedBackupSnapshotsTelemetrySnapshot {
  readonly featureId: typeof F152_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F152_CONFIG: F152AutomatedBackupSnapshotsConfig = {
  featureId: F152_FEATURE_ID,
  stage: F152_STAGE,
  operationCode: F152_OPERATION_CODE,
  contractVersion: F152_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F152AutomatedBackupSnapshotsValidationError extends Error {
  public readonly featureId = F152_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F152 Validation Error on '${field}']: ${message}`);
    this.name = "F152AutomatedBackupSnapshotsValidationError";
    this.field = field;
  }
}

export function computeF152Digest(rawPayload: string): string {
  return `f152_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F152AutomatedBackupSnapshotsEngine {
  private readonly config: F152AutomatedBackupSnapshotsConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F152AutomatedBackupSnapshotsOutput[] = [];
  private readonly auditLog: F152AutomatedBackupSnapshotsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F152AutomatedBackupSnapshotsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F152AutomatedBackupSnapshotsConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F152_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F152AutomatedBackupSnapshotsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F152AutomatedBackupSnapshotsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F152AutomatedBackupSnapshotsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.snapshot_id).trim().length === 0) {
      throw new F152AutomatedBackupSnapshotsValidationError("snapshot_id", "Primary domain attribute 'snapshot_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      snapshot_id: input.snapshot_id,
      included_graphs: input.included_graphs,
      included_canvas_tabs: input.included_canvas_tabs,
      one_click_restorable: input.one_click_restorable
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F152AutomatedBackupSnapshotsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F152AutomatedBackupSnapshotsInput): F152AutomatedBackupSnapshotsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F152_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        snapshot_id: input.snapshot_id,
        included_graphs: input.included_graphs,
        included_canvas_tabs: input.included_canvas_tabs,
        one_click_restorable: input.one_click_restorable
      });
      const payloadHash = computeF152Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F152AutomatedBackupSnapshotsValidationError(
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
        featureId: F152_FEATURE_ID,
        operationCode: F152_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          snapshot_id: input.snapshot_id,
          included_graphs: input.included_graphs,
          included_canvas_tabs: input.included_canvas_tabs,
          one_click_restorable: input.one_click_restorable
        }
      });

      const executionId = `exec_f152_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f152_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F152AutomatedBackupSnapshotsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F152_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `snapshot_backup_engine:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F152AutomatedBackupSnapshotsOutput = {
        featureId: F152_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F152_OPERATION_CODE,
        resolved_snapshot_id: kernelResult.resolvedFields.snapshot_id as string,
        resolved_included_graphs: kernelResult.resolvedFields.included_graphs as string | number,
        resolved_included_canvas_tabs: kernelResult.resolvedFields.included_canvas_tabs as string | number | boolean | readonly string[],
        resolved_one_click_restorable: kernelResult.resolvedFields.one_click_restorable as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F152AutomatedBackupSnapshotsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F152_FEATURE_ID,
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

  public getAuditTrail(): readonly F152AutomatedBackupSnapshotsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F152AutomatedBackupSnapshotsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF152Module(): {
  featureId: typeof F152_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F152AutomatedBackupSnapshotsEngine();
  const sampleInput: F152AutomatedBackupSnapshotsInput = {
    requestId: "req_verify_f152",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    snapshot_id: "f152_snapshot_id_seed",
    included_graphs: 42,
    included_canvas_tabs: true,
    one_click_restorable: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 152 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F152" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_snapshot_id !== sampleInput.snapshot_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F152_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
