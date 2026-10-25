/**
 * F028 (stage1-autonomy): Передача контекста между агентами без потерь (Context Handoff)
 * Сжатие истории с сохранением ключевых фактов при передаче эстафеты
 * Operation Code: context_handoff
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F028_FEATURE_ID = "F028" as const;
export const F028_STAGE = "stage1-autonomy" as const;
export const F028_OPERATION_CODE = "context_handoff" as const;
export const F028_CONTRACT_VERSION = "2.0.0" as const;

export type F028LosslessContextHandoffExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F028LosslessContextHandoffConfig {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly stage: typeof F028_STAGE;
  readonly operationCode: typeof F028_OPERATION_CODE;
  readonly contractVersion: typeof F028_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F028LosslessContextHandoffInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly handoff_id: string;
  readonly from_role: string | number;
  readonly to_role: string | number | boolean | readonly string[];
  readonly preserved_facts_digest: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F028LosslessContextHandoffAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F028_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F028LosslessContextHandoffOutput {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F028LosslessContextHandoffExecutionStatus;
  readonly operationCode: typeof F028_OPERATION_CODE;
  readonly resolved_handoff_id: string;
  readonly resolved_from_role: string | number;
  readonly resolved_to_role: string | number | boolean | readonly string[];
  readonly resolved_preserved_facts_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F028LosslessContextHandoffAuditEntry;
}

export interface F028LosslessContextHandoffTelemetrySnapshot {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F028_CONFIG: F028LosslessContextHandoffConfig = {
  featureId: F028_FEATURE_ID,
  stage: F028_STAGE,
  operationCode: F028_OPERATION_CODE,
  contractVersion: F028_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F028LosslessContextHandoffValidationError extends Error {
  public readonly featureId = F028_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F028 Validation Error on '${field}']: ${message}`);
    this.name = "F028LosslessContextHandoffValidationError";
    this.field = field;
  }
}

export function computeF028Digest(rawPayload: string): string {
  return `f028_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F028LosslessContextHandoffEngine {
  private readonly config: F028LosslessContextHandoffConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F028LosslessContextHandoffOutput[] = [];
  private readonly auditLog: F028LosslessContextHandoffAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F028LosslessContextHandoffOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F028LosslessContextHandoffConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F028_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F028LosslessContextHandoffConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F028LosslessContextHandoffInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F028LosslessContextHandoffValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.handoff_id).trim().length === 0) {
      throw new F028LosslessContextHandoffValidationError("handoff_id", "Primary domain attribute 'handoff_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      handoff_id: input.handoff_id,
      from_role: input.from_role,
      to_role: input.to_role,
      preserved_facts_digest: input.preserved_facts_digest
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F028LosslessContextHandoffValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F028LosslessContextHandoffInput): F028LosslessContextHandoffOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F028_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        handoff_id: input.handoff_id,
        from_role: input.from_role,
        to_role: input.to_role,
        preserved_facts_digest: input.preserved_facts_digest
      });
      const payloadHash = computeF028Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F028LosslessContextHandoffValidationError(
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
        featureId: F028_FEATURE_ID,
        operationCode: F028_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          handoff_id: input.handoff_id,
          from_role: input.from_role,
          to_role: input.to_role,
          preserved_facts_digest: input.preserved_facts_digest
        }
      });

      const executionId = `exec_f028_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f028_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F028LosslessContextHandoffAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F028_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `context_handoff:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F028LosslessContextHandoffOutput = {
        featureId: F028_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F028_OPERATION_CODE,
        resolved_handoff_id: kernelResult.resolvedFields.handoff_id as string,
        resolved_from_role: kernelResult.resolvedFields.from_role as string | number,
        resolved_to_role: kernelResult.resolvedFields.to_role as string | number | boolean | readonly string[],
        resolved_preserved_facts_digest: kernelResult.resolvedFields.preserved_facts_digest as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F028LosslessContextHandoffTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F028_FEATURE_ID,
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

  public getAuditTrail(): readonly F028LosslessContextHandoffAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F028LosslessContextHandoffOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF028Module(): {
  featureId: typeof F028_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F028LosslessContextHandoffEngine();
  const sampleInput: F028LosslessContextHandoffInput = {
    requestId: "req_verify_f028",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    handoff_id: "f028_handoff_id_seed",
    from_role: 42,
    to_role: true,
    preserved_facts_digest: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 28 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F028" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_handoff_id !== sampleInput.handoff_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F028_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
