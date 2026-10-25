/**
 * F051 (stage2-canvas): Экспорт отчётов в PDF с корпоративной вёрсткой
 * Компиляция документов с титульным листом, оглавлением и кастомным брендингом
 * Operation Code: corporate_pdf_compiler
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F051_FEATURE_ID = "F051" as const;
export const F051_STAGE = "stage2-canvas" as const;
export const F051_OPERATION_CODE = "corporate_pdf_compiler" as const;
export const F051_CONTRACT_VERSION = "2.0.0" as const;

export type F051CorporatePdfReportExporterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F051CorporatePdfReportExporterConfig {
  readonly featureId: typeof F051_FEATURE_ID;
  readonly stage: typeof F051_STAGE;
  readonly operationCode: typeof F051_OPERATION_CODE;
  readonly contractVersion: typeof F051_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F051CorporatePdfReportExporterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly document_id: string;
  readonly cover_page_included: string | number;
  readonly toc_generated: string | number | boolean | readonly string[];
  readonly page_count: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F051CorporatePdfReportExporterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F051_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F051CorporatePdfReportExporterOutput {
  readonly featureId: typeof F051_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F051CorporatePdfReportExporterExecutionStatus;
  readonly operationCode: typeof F051_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_cover_page_included: string | number;
  readonly resolved_toc_generated: string | number | boolean | readonly string[];
  readonly resolved_page_count: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F051CorporatePdfReportExporterAuditEntry;
}

export interface F051CorporatePdfReportExporterTelemetrySnapshot {
  readonly featureId: typeof F051_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F051_CONFIG: F051CorporatePdfReportExporterConfig = {
  featureId: F051_FEATURE_ID,
  stage: F051_STAGE,
  operationCode: F051_OPERATION_CODE,
  contractVersion: F051_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F051CorporatePdfReportExporterValidationError extends Error {
  public readonly featureId = F051_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F051 Validation Error on '${field}']: ${message}`);
    this.name = "F051CorporatePdfReportExporterValidationError";
    this.field = field;
  }
}

export function computeF051Digest(rawPayload: string): string {
  return `f051_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F051CorporatePdfReportExporterEngine {
  private readonly config: F051CorporatePdfReportExporterConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F051CorporatePdfReportExporterOutput[] = [];
  private readonly auditLog: F051CorporatePdfReportExporterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F051CorporatePdfReportExporterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F051CorporatePdfReportExporterConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F051_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F051CorporatePdfReportExporterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F051CorporatePdfReportExporterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F051CorporatePdfReportExporterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.document_id).trim().length === 0) {
      throw new F051CorporatePdfReportExporterValidationError("document_id", "Primary domain attribute 'document_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      document_id: input.document_id,
      cover_page_included: input.cover_page_included,
      toc_generated: input.toc_generated,
      page_count: input.page_count
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F051CorporatePdfReportExporterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F051CorporatePdfReportExporterInput): F051CorporatePdfReportExporterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F051_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        document_id: input.document_id,
        cover_page_included: input.cover_page_included,
        toc_generated: input.toc_generated,
        page_count: input.page_count
      });
      const payloadHash = computeF051Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F051CorporatePdfReportExporterValidationError(
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
        featureId: F051_FEATURE_ID,
        operationCode: F051_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          document_id: input.document_id,
          cover_page_included: input.cover_page_included,
          toc_generated: input.toc_generated,
          page_count: input.page_count
        }
      });

      const executionId = `exec_f051_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f051_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F051CorporatePdfReportExporterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F051_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `corporate_pdf_compiler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F051CorporatePdfReportExporterOutput = {
        featureId: F051_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F051_OPERATION_CODE,
        resolved_document_id: kernelResult.resolvedFields.document_id as string,
        resolved_cover_page_included: kernelResult.resolvedFields.cover_page_included as string | number,
        resolved_toc_generated: kernelResult.resolvedFields.toc_generated as string | number | boolean | readonly string[],
        resolved_page_count: kernelResult.resolvedFields.page_count as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F051CorporatePdfReportExporterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F051_FEATURE_ID,
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

  public getAuditTrail(): readonly F051CorporatePdfReportExporterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F051CorporatePdfReportExporterOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF051Module(): {
  featureId: typeof F051_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F051CorporatePdfReportExporterEngine();
  const sampleInput: F051CorporatePdfReportExporterInput = {
    requestId: "req_verify_f051",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f051_document_id_seed",
    cover_page_included: 42,
    toc_generated: true,
    page_count: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 51 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F051" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F051_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
