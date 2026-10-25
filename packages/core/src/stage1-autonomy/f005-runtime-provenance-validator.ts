/**
 * F005 (stage1-autonomy): Валидатор графа происхождения в рантайме
 * Автоматическая проверка целостности ссылок provenance перед закрытием задачи менеджером
 * Operation Code: provenance_validator
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F005_FEATURE_ID = "F005" as const;
export const F005_STAGE = "stage1-autonomy" as const;
export const F005_OPERATION_CODE = "provenance_validator" as const;
export const F005_CONTRACT_VERSION = "2.0.0" as const;

export type F005RuntimeProvenanceValidatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F005RuntimeProvenanceValidatorConfig {
  readonly featureId: typeof F005_FEATURE_ID;
  readonly stage: typeof F005_STAGE;
  readonly operationCode: typeof F005_OPERATION_CODE;
  readonly contractVersion: typeof F005_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F005RuntimeProvenanceValidatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly checked_nodes: string | number;
  readonly integrity_passed: string | number | boolean | readonly string[];
  readonly missing_links: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F005RuntimeProvenanceValidatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F005_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F005RuntimeProvenanceValidatorOutput {
  readonly featureId: typeof F005_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F005RuntimeProvenanceValidatorExecutionStatus;
  readonly operationCode: typeof F005_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_checked_nodes: string | number;
  readonly resolved_integrity_passed: string | number | boolean | readonly string[];
  readonly resolved_missing_links: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F005RuntimeProvenanceValidatorAuditEntry;
}

export interface F005RuntimeProvenanceValidatorTelemetrySnapshot {
  readonly featureId: typeof F005_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F005_CONFIG: F005RuntimeProvenanceValidatorConfig = {
  featureId: F005_FEATURE_ID,
  stage: F005_STAGE,
  operationCode: F005_OPERATION_CODE,
  contractVersion: F005_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F005RuntimeProvenanceValidatorValidationError extends Error {
  public readonly featureId = F005_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F005 Validation Error on '${field}']: ${message}`);
    this.name = "F005RuntimeProvenanceValidatorValidationError";
    this.field = field;
  }
}

export function computeF005Digest(rawPayload: string): string {
  return `f005_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F005RuntimeProvenanceValidatorEngine {
  private readonly config: F005RuntimeProvenanceValidatorConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F005RuntimeProvenanceValidatorOutput[] = [];
  private readonly auditLog: F005RuntimeProvenanceValidatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F005RuntimeProvenanceValidatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F005RuntimeProvenanceValidatorConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F005_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F005RuntimeProvenanceValidatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F005RuntimeProvenanceValidatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F005RuntimeProvenanceValidatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F005RuntimeProvenanceValidatorValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      graph_id: input.graph_id,
      checked_nodes: input.checked_nodes,
      integrity_passed: input.integrity_passed,
      missing_links: input.missing_links
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F005RuntimeProvenanceValidatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F005RuntimeProvenanceValidatorInput): F005RuntimeProvenanceValidatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F005_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        graph_id: input.graph_id,
        checked_nodes: input.checked_nodes,
        integrity_passed: input.integrity_passed,
        missing_links: input.missing_links
      });
      const payloadHash = computeF005Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F005RuntimeProvenanceValidatorValidationError(
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
        featureId: F005_FEATURE_ID,
        operationCode: F005_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          graph_id: input.graph_id,
          checked_nodes: input.checked_nodes,
          integrity_passed: input.integrity_passed,
          missing_links: input.missing_links
        }
      });

      const executionId = `exec_f005_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f005_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F005RuntimeProvenanceValidatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F005_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provenance_validator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F005RuntimeProvenanceValidatorOutput = {
        featureId: F005_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F005_OPERATION_CODE,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string,
        resolved_checked_nodes: kernelResult.resolvedFields.checked_nodes as string | number,
        resolved_integrity_passed: kernelResult.resolvedFields.integrity_passed as string | number | boolean | readonly string[],
        resolved_missing_links: kernelResult.resolvedFields.missing_links as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F005RuntimeProvenanceValidatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F005_FEATURE_ID,
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

  public getAuditTrail(): readonly F005RuntimeProvenanceValidatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F005RuntimeProvenanceValidatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF005Module(): {
  featureId: typeof F005_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F005RuntimeProvenanceValidatorEngine();
  const sampleInput: F005RuntimeProvenanceValidatorInput = {
    requestId: "req_verify_f005",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f005_graph_id_seed",
    checked_nodes: 42,
    integrity_passed: true,
    missing_links: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 5 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F005" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F005_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
