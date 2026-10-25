/**
 * F056 (stage2-canvas): Библиотека шаблонов артефактов
 * Готовые каркасы для питч-деков, ТЗ, финансовых моделей и дизайн-доков
 * Operation Code: template_catalog
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F056_FEATURE_ID = "F056" as const;
export const F056_STAGE = "stage2-canvas" as const;
export const F056_OPERATION_CODE = "template_catalog" as const;
export const F056_CONTRACT_VERSION = "2.0.0" as const;

export type F056ArtifactTemplatesLibraryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F056ArtifactTemplatesLibraryConfig {
  readonly featureId: typeof F056_FEATURE_ID;
  readonly stage: typeof F056_STAGE;
  readonly operationCode: typeof F056_OPERATION_CODE;
  readonly contractVersion: typeof F056_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F056ArtifactTemplatesLibraryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly template_id: string;
  readonly category: string | number;
  readonly sections_scaffold: string | number | boolean | readonly string[];
  readonly default_variables: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F056ArtifactTemplatesLibraryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F056_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F056ArtifactTemplatesLibraryOutput {
  readonly featureId: typeof F056_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F056ArtifactTemplatesLibraryExecutionStatus;
  readonly operationCode: typeof F056_OPERATION_CODE;
  readonly resolved_template_id: string;
  readonly resolved_category: string | number;
  readonly resolved_sections_scaffold: string | number | boolean | readonly string[];
  readonly resolved_default_variables: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F056ArtifactTemplatesLibraryAuditEntry;
}

export interface F056ArtifactTemplatesLibraryTelemetrySnapshot {
  readonly featureId: typeof F056_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F056_CONFIG: F056ArtifactTemplatesLibraryConfig = {
  featureId: F056_FEATURE_ID,
  stage: F056_STAGE,
  operationCode: F056_OPERATION_CODE,
  contractVersion: F056_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F056ArtifactTemplatesLibraryValidationError extends Error {
  public readonly featureId = F056_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F056 Validation Error on '${field}']: ${message}`);
    this.name = "F056ArtifactTemplatesLibraryValidationError";
    this.field = field;
  }
}

export function computeF056Digest(rawPayload: string): string {
  return `f056_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F056ArtifactTemplatesLibraryEngine {
  private readonly config: F056ArtifactTemplatesLibraryConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F056ArtifactTemplatesLibraryOutput[] = [];
  private readonly auditLog: F056ArtifactTemplatesLibraryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F056ArtifactTemplatesLibraryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F056ArtifactTemplatesLibraryConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F056_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F056ArtifactTemplatesLibraryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F056ArtifactTemplatesLibraryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F056ArtifactTemplatesLibraryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.template_id).trim().length === 0) {
      throw new F056ArtifactTemplatesLibraryValidationError("template_id", "Primary domain attribute 'template_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      template_id: input.template_id,
      category: input.category,
      sections_scaffold: input.sections_scaffold,
      default_variables: input.default_variables
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F056ArtifactTemplatesLibraryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F056ArtifactTemplatesLibraryInput): F056ArtifactTemplatesLibraryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F056_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        template_id: input.template_id,
        category: input.category,
        sections_scaffold: input.sections_scaffold,
        default_variables: input.default_variables
      });
      const payloadHash = computeF056Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F056ArtifactTemplatesLibraryValidationError(
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
        featureId: F056_FEATURE_ID,
        operationCode: F056_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          template_id: input.template_id,
          category: input.category,
          sections_scaffold: input.sections_scaffold,
          default_variables: input.default_variables
        }
      });

      const executionId = `exec_f056_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f056_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F056ArtifactTemplatesLibraryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F056_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `template_catalog:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F056ArtifactTemplatesLibraryOutput = {
        featureId: F056_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F056_OPERATION_CODE,
        resolved_template_id: kernelResult.resolvedFields.template_id as string,
        resolved_category: kernelResult.resolvedFields.category as string | number,
        resolved_sections_scaffold: kernelResult.resolvedFields.sections_scaffold as string | number | boolean | readonly string[],
        resolved_default_variables: kernelResult.resolvedFields.default_variables as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F056ArtifactTemplatesLibraryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F056_FEATURE_ID,
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

  public getAuditTrail(): readonly F056ArtifactTemplatesLibraryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F056ArtifactTemplatesLibraryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF056Module(): {
  featureId: typeof F056_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F056ArtifactTemplatesLibraryEngine();
  const sampleInput: F056ArtifactTemplatesLibraryInput = {
    requestId: "req_verify_f056",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    template_id: "f056_template_id_seed",
    category: 42,
    sections_scaffold: true,
    default_variables: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 56 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F056" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_template_id !== sampleInput.template_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F056_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
