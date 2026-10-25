/**
 * F119 (stage4-intelligence-graph): Поиск «белых пятен» в графе (Gap Analysis)
 * Выявление задач или разделов отчёта, не подкреплённых ни одним исходным документом
 * Operation Code: evidence_gap_finder
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F119_FEATURE_ID = "F119" as const;
export const F119_STAGE = "stage4-intelligence-graph" as const;
export const F119_OPERATION_CODE = "evidence_gap_finder" as const;
export const F119_CONTRACT_VERSION = "2.0.0" as const;

export type F119GraphGapAnalyzerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F119GraphGapAnalyzerConfig {
  readonly featureId: typeof F119_FEATURE_ID;
  readonly stage: typeof F119_STAGE;
  readonly operationCode: typeof F119_OPERATION_CODE;
  readonly contractVersion: typeof F119_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F119GraphGapAnalyzerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly unbacked_task_ids: string | number;
  readonly orphan_claims_count: string | number | boolean | readonly string[];
  readonly remediation_plan: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F119GraphGapAnalyzerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F119_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F119GraphGapAnalyzerOutput {
  readonly featureId: typeof F119_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F119GraphGapAnalyzerExecutionStatus;
  readonly operationCode: typeof F119_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_unbacked_task_ids: string | number;
  readonly resolved_orphan_claims_count: string | number | boolean | readonly string[];
  readonly resolved_remediation_plan: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F119GraphGapAnalyzerAuditEntry;
}

export interface F119GraphGapAnalyzerTelemetrySnapshot {
  readonly featureId: typeof F119_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F119_CONFIG: F119GraphGapAnalyzerConfig = {
  featureId: F119_FEATURE_ID,
  stage: F119_STAGE,
  operationCode: F119_OPERATION_CODE,
  contractVersion: F119_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F119GraphGapAnalyzerValidationError extends Error {
  public readonly featureId = F119_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F119 Validation Error on '${field}']: ${message}`);
    this.name = "F119GraphGapAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF119Digest(rawPayload: string): string {
  return `f119_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F119GraphGapAnalyzerEngine {
  private readonly config: F119GraphGapAnalyzerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F119GraphGapAnalyzerOutput[] = [];
  private readonly auditLog: F119GraphGapAnalyzerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F119GraphGapAnalyzerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F119GraphGapAnalyzerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F119_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F119GraphGapAnalyzerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F119GraphGapAnalyzerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F119GraphGapAnalyzerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F119GraphGapAnalyzerValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      unbacked_task_ids: input.unbacked_task_ids,
      orphan_claims_count: input.orphan_claims_count,
      remediation_plan: input.remediation_plan
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F119GraphGapAnalyzerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F119GraphGapAnalyzerInput): F119GraphGapAnalyzerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F119_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        unbacked_task_ids: input.unbacked_task_ids,
        orphan_claims_count: input.orphan_claims_count,
        remediation_plan: input.remediation_plan
      });
      const payloadHash = computeF119Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F119GraphGapAnalyzerValidationError(
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
        featureId: F119_FEATURE_ID,
        operationCode: F119_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          unbacked_task_ids: input.unbacked_task_ids,
          orphan_claims_count: input.orphan_claims_count,
          remediation_plan: input.remediation_plan
        }
      });

      const executionId = `exec_f119_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f119_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F119GraphGapAnalyzerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F119_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `evidence_gap_finder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F119GraphGapAnalyzerOutput = {
        featureId: F119_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F119_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_unbacked_task_ids: kernelResult.resolvedFields.unbacked_task_ids as string | number,
        resolved_orphan_claims_count: kernelResult.resolvedFields.orphan_claims_count as string | number | boolean | readonly string[],
        resolved_remediation_plan: kernelResult.resolvedFields.remediation_plan as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F119GraphGapAnalyzerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F119_FEATURE_ID,
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

  public getAuditTrail(): readonly F119GraphGapAnalyzerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F119GraphGapAnalyzerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF119Module(): {
  featureId: typeof F119_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F119GraphGapAnalyzerEngine();
  const sampleInput: F119GraphGapAnalyzerInput = {
    requestId: "req_verify_f119",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f119_workspace_id_seed",
    unbacked_task_ids: 42,
    orphan_claims_count: true,
    remediation_plan: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 119 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F119" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F119_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
