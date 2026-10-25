/**
 * F053 (stage2-canvas): Оглавление и быстрая навигация по длинным отчётам
 * Плавающее дерево заголовков (H1–H4) для документов свыше 10 страниц
 * Operation Code: floating_toc_tree
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F053_FEATURE_ID = "F053" as const;
export const F053_STAGE = "stage2-canvas" as const;
export const F053_OPERATION_CODE = "floating_toc_tree" as const;
export const F053_CONTRACT_VERSION = "2.0.0" as const;

export type F053FloatingTocNavigatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F053FloatingTocNavigatorConfig {
  readonly featureId: typeof F053_FEATURE_ID;
  readonly stage: typeof F053_STAGE;
  readonly operationCode: typeof F053_OPERATION_CODE;
  readonly contractVersion: typeof F053_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F053FloatingTocNavigatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly document_id: string;
  readonly headings_extracted: string | number;
  readonly max_depth: string | number | boolean | readonly string[];
  readonly active_anchor_slug: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F053FloatingTocNavigatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F053_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F053FloatingTocNavigatorOutput {
  readonly featureId: typeof F053_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F053FloatingTocNavigatorExecutionStatus;
  readonly operationCode: typeof F053_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_headings_extracted: string | number;
  readonly resolved_max_depth: string | number | boolean | readonly string[];
  readonly resolved_active_anchor_slug: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F053FloatingTocNavigatorAuditEntry;
}

export interface F053FloatingTocNavigatorTelemetrySnapshot {
  readonly featureId: typeof F053_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F053_CONFIG: F053FloatingTocNavigatorConfig = {
  featureId: F053_FEATURE_ID,
  stage: F053_STAGE,
  operationCode: F053_OPERATION_CODE,
  contractVersion: F053_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F053FloatingTocNavigatorValidationError extends Error {
  public readonly featureId = F053_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F053 Validation Error on '${field}']: ${message}`);
    this.name = "F053FloatingTocNavigatorValidationError";
    this.field = field;
  }
}

export function computeF053Digest(rawPayload: string): string {
  return `f053_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F053FloatingTocNavigatorEngine {
  private readonly config: F053FloatingTocNavigatorConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F053FloatingTocNavigatorOutput[] = [];
  private readonly auditLog: F053FloatingTocNavigatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F053FloatingTocNavigatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F053FloatingTocNavigatorConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F053_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F053FloatingTocNavigatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F053FloatingTocNavigatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F053FloatingTocNavigatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.document_id).trim().length === 0) {
      throw new F053FloatingTocNavigatorValidationError("document_id", "Primary domain attribute 'document_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      document_id: input.document_id,
      headings_extracted: input.headings_extracted,
      max_depth: input.max_depth,
      active_anchor_slug: input.active_anchor_slug
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F053FloatingTocNavigatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F053FloatingTocNavigatorInput): F053FloatingTocNavigatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F053_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        document_id: input.document_id,
        headings_extracted: input.headings_extracted,
        max_depth: input.max_depth,
        active_anchor_slug: input.active_anchor_slug
      });
      const payloadHash = computeF053Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F053FloatingTocNavigatorValidationError(
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
        featureId: F053_FEATURE_ID,
        operationCode: F053_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          document_id: input.document_id,
          headings_extracted: input.headings_extracted,
          max_depth: input.max_depth,
          active_anchor_slug: input.active_anchor_slug
        }
      });

      const executionId = `exec_f053_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f053_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F053FloatingTocNavigatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F053_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `floating_toc_tree:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F053FloatingTocNavigatorOutput = {
        featureId: F053_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F053_OPERATION_CODE,
        resolved_document_id: kernelResult.resolvedFields.document_id as string,
        resolved_headings_extracted: kernelResult.resolvedFields.headings_extracted as string | number,
        resolved_max_depth: kernelResult.resolvedFields.max_depth as string | number | boolean | readonly string[],
        resolved_active_anchor_slug: kernelResult.resolvedFields.active_anchor_slug as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F053FloatingTocNavigatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F053_FEATURE_ID,
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

  public getAuditTrail(): readonly F053FloatingTocNavigatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F053FloatingTocNavigatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF053Module(): {
  featureId: typeof F053_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F053FloatingTocNavigatorEngine();
  const sampleInput: F053FloatingTocNavigatorInput = {
    requestId: "req_verify_f053",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f053_document_id_seed",
    headings_extracted: 42,
    max_depth: true,
    active_anchor_slug: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 53 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F053" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F053_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
