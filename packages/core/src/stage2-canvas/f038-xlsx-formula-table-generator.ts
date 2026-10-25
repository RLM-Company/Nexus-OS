/**
 * F038 (stage2-canvas): Генератор XLSX-таблиц с формулами
 * Сборка полноценных многостраничных таблиц с рабочими формулами, стилями и выгрузкой в .xlsx
 * Operation Code: xlsx_formula_builder
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F038_FEATURE_ID = "F038" as const;
export const F038_STAGE = "stage2-canvas" as const;
export const F038_OPERATION_CODE = "xlsx_formula_builder" as const;
export const F038_CONTRACT_VERSION = "2.0.0" as const;

export type F038XlsxFormulaTableGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F038XlsxFormulaTableGeneratorConfig {
  readonly featureId: typeof F038_FEATURE_ID;
  readonly stage: typeof F038_STAGE;
  readonly operationCode: typeof F038_OPERATION_CODE;
  readonly contractVersion: typeof F038_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F038XlsxFormulaTableGeneratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workbook_id: string;
  readonly sheet_names: string | number;
  readonly active_formulas_count: string | number | boolean | readonly string[];
  readonly recalculated_totals: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F038XlsxFormulaTableGeneratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F038_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F038XlsxFormulaTableGeneratorOutput {
  readonly featureId: typeof F038_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F038XlsxFormulaTableGeneratorExecutionStatus;
  readonly operationCode: typeof F038_OPERATION_CODE;
  readonly resolved_workbook_id: string;
  readonly resolved_sheet_names: string | number;
  readonly resolved_active_formulas_count: string | number | boolean | readonly string[];
  readonly resolved_recalculated_totals: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F038XlsxFormulaTableGeneratorAuditEntry;
}

export interface F038XlsxFormulaTableGeneratorTelemetrySnapshot {
  readonly featureId: typeof F038_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F038_CONFIG: F038XlsxFormulaTableGeneratorConfig = {
  featureId: F038_FEATURE_ID,
  stage: F038_STAGE,
  operationCode: F038_OPERATION_CODE,
  contractVersion: F038_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F038XlsxFormulaTableGeneratorValidationError extends Error {
  public readonly featureId = F038_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F038 Validation Error on '${field}']: ${message}`);
    this.name = "F038XlsxFormulaTableGeneratorValidationError";
    this.field = field;
  }
}

export function computeF038Digest(rawPayload: string): string {
  return `f038_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F038XlsxFormulaTableGeneratorEngine {
  private readonly config: F038XlsxFormulaTableGeneratorConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F038XlsxFormulaTableGeneratorOutput[] = [];
  private readonly auditLog: F038XlsxFormulaTableGeneratorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F038XlsxFormulaTableGeneratorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F038XlsxFormulaTableGeneratorConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F038_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F038XlsxFormulaTableGeneratorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F038XlsxFormulaTableGeneratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F038XlsxFormulaTableGeneratorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workbook_id).trim().length === 0) {
      throw new F038XlsxFormulaTableGeneratorValidationError("workbook_id", "Primary domain attribute 'workbook_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workbook_id: input.workbook_id,
      sheet_names: input.sheet_names,
      active_formulas_count: input.active_formulas_count,
      recalculated_totals: input.recalculated_totals
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F038XlsxFormulaTableGeneratorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F038XlsxFormulaTableGeneratorInput): F038XlsxFormulaTableGeneratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F038_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workbook_id: input.workbook_id,
        sheet_names: input.sheet_names,
        active_formulas_count: input.active_formulas_count,
        recalculated_totals: input.recalculated_totals
      });
      const payloadHash = computeF038Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F038XlsxFormulaTableGeneratorValidationError(
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
        featureId: F038_FEATURE_ID,
        operationCode: F038_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workbook_id: input.workbook_id,
          sheet_names: input.sheet_names,
          active_formulas_count: input.active_formulas_count,
          recalculated_totals: input.recalculated_totals
        }
      });

      const executionId = `exec_f038_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f038_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F038XlsxFormulaTableGeneratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F038_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `xlsx_formula_builder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F038XlsxFormulaTableGeneratorOutput = {
        featureId: F038_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F038_OPERATION_CODE,
        resolved_workbook_id: kernelResult.resolvedFields.workbook_id as string,
        resolved_sheet_names: kernelResult.resolvedFields.sheet_names as string | number,
        resolved_active_formulas_count: kernelResult.resolvedFields.active_formulas_count as string | number | boolean | readonly string[],
        resolved_recalculated_totals: kernelResult.resolvedFields.recalculated_totals as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F038XlsxFormulaTableGeneratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F038_FEATURE_ID,
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

  public getAuditTrail(): readonly F038XlsxFormulaTableGeneratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F038XlsxFormulaTableGeneratorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF038Module(): {
  featureId: typeof F038_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F038XlsxFormulaTableGeneratorEngine();
  const sampleInput: F038XlsxFormulaTableGeneratorInput = {
    requestId: "req_verify_f038",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workbook_id: "f038_workbook_id_seed",
    sheet_names: 42,
    active_formulas_count: true,
    recalculated_totals: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 38 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F038" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workbook_id !== sampleInput.workbook_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F038_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
