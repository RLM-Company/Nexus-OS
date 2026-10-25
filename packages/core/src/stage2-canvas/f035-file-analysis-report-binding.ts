/**
 * F035 (stage2-canvas): Прямая связь анализа файлов с отчётами (File Analysis-to-Report Binding)
 * Живые ссылки из выводов в отчёте на конкретные строки/ячейки исходного загруженного файла
 * Operation Code: cell_citation_binding
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F035_FEATURE_ID = "F035" as const;
export const F035_STAGE = "stage2-canvas" as const;
export const F035_OPERATION_CODE = "cell_citation_binding" as const;
export const F035_CONTRACT_VERSION = "2.0.0" as const;

export type F035FileAnalysisReportBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F035FileAnalysisReportBindingConfig {
  readonly featureId: typeof F035_FEATURE_ID;
  readonly stage: typeof F035_STAGE;
  readonly operationCode: typeof F035_OPERATION_CODE;
  readonly contractVersion: typeof F035_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F035FileAnalysisReportBindingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly binding_id: string;
  readonly source_file_id: string | number;
  readonly sheet_cell_coord: string | number | boolean | readonly string[];
  readonly bound_report_paragraph: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F035FileAnalysisReportBindingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F035_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F035FileAnalysisReportBindingOutput {
  readonly featureId: typeof F035_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F035FileAnalysisReportBindingExecutionStatus;
  readonly operationCode: typeof F035_OPERATION_CODE;
  readonly resolved_binding_id: string;
  readonly resolved_source_file_id: string | number;
  readonly resolved_sheet_cell_coord: string | number | boolean | readonly string[];
  readonly resolved_bound_report_paragraph: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F035FileAnalysisReportBindingAuditEntry;
}

export interface F035FileAnalysisReportBindingTelemetrySnapshot {
  readonly featureId: typeof F035_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F035_CONFIG: F035FileAnalysisReportBindingConfig = {
  featureId: F035_FEATURE_ID,
  stage: F035_STAGE,
  operationCode: F035_OPERATION_CODE,
  contractVersion: F035_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F035FileAnalysisReportBindingValidationError extends Error {
  public readonly featureId = F035_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F035 Validation Error on '${field}']: ${message}`);
    this.name = "F035FileAnalysisReportBindingValidationError";
    this.field = field;
  }
}

export function computeF035Digest(rawPayload: string): string {
  return `f035_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F035FileAnalysisReportBindingEngine {
  private readonly config: F035FileAnalysisReportBindingConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F035FileAnalysisReportBindingOutput[] = [];
  private readonly auditLog: F035FileAnalysisReportBindingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F035FileAnalysisReportBindingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F035FileAnalysisReportBindingConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F035_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F035FileAnalysisReportBindingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F035FileAnalysisReportBindingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F035FileAnalysisReportBindingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.binding_id).trim().length === 0) {
      throw new F035FileAnalysisReportBindingValidationError("binding_id", "Primary domain attribute 'binding_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      binding_id: input.binding_id,
      source_file_id: input.source_file_id,
      sheet_cell_coord: input.sheet_cell_coord,
      bound_report_paragraph: input.bound_report_paragraph
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F035FileAnalysisReportBindingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F035FileAnalysisReportBindingInput): F035FileAnalysisReportBindingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F035_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        binding_id: input.binding_id,
        source_file_id: input.source_file_id,
        sheet_cell_coord: input.sheet_cell_coord,
        bound_report_paragraph: input.bound_report_paragraph
      });
      const payloadHash = computeF035Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F035FileAnalysisReportBindingValidationError(
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
        featureId: F035_FEATURE_ID,
        operationCode: F035_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          binding_id: input.binding_id,
          source_file_id: input.source_file_id,
          sheet_cell_coord: input.sheet_cell_coord,
          bound_report_paragraph: input.bound_report_paragraph
        }
      });

      const executionId = `exec_f035_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f035_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F035FileAnalysisReportBindingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F035_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `cell_citation_binding:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F035FileAnalysisReportBindingOutput = {
        featureId: F035_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F035_OPERATION_CODE,
        resolved_binding_id: kernelResult.resolvedFields.binding_id as string,
        resolved_source_file_id: kernelResult.resolvedFields.source_file_id as string | number,
        resolved_sheet_cell_coord: kernelResult.resolvedFields.sheet_cell_coord as string | number | boolean | readonly string[],
        resolved_bound_report_paragraph: kernelResult.resolvedFields.bound_report_paragraph as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F035FileAnalysisReportBindingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F035_FEATURE_ID,
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

  public getAuditTrail(): readonly F035FileAnalysisReportBindingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F035FileAnalysisReportBindingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF035Module(): {
  featureId: typeof F035_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F035FileAnalysisReportBindingEngine();
  const sampleInput: F035FileAnalysisReportBindingInput = {
    requestId: "req_verify_f035",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    binding_id: "f035_binding_id_seed",
    source_file_id: 42,
    sheet_cell_coord: true,
    bound_report_paragraph: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 35 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F035" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_binding_id !== sampleInput.binding_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F035_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
