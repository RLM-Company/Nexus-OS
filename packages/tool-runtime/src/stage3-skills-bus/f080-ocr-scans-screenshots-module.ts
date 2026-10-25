/**
 * F080 (stage3-skills-bus): OCR-модуль для сканов и скриншотов
 * Распознавание текста и таблиц с изображений и фотографий документов
 * Operation Code: ocr_vision_extractor
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F080_FEATURE_ID = "F080" as const;
export const F080_STAGE = "stage3-skills-bus" as const;
export const F080_OPERATION_CODE = "ocr_vision_extractor" as const;
export const F080_CONTRACT_VERSION = "2.0.0" as const;

export type F080OcrScansScreenshotsModuleExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F080OcrScansScreenshotsModuleConfig {
  readonly featureId: typeof F080_FEATURE_ID;
  readonly stage: typeof F080_STAGE;
  readonly operationCode: typeof F080_OPERATION_CODE;
  readonly contractVersion: typeof F080_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F080OcrScansScreenshotsModuleInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly image_id: string;
  readonly recognized_text: string | number;
  readonly confidence_pct: string | number | boolean | readonly string[];
  readonly detected_table_cells: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F080OcrScansScreenshotsModuleAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F080_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F080OcrScansScreenshotsModuleOutput {
  readonly featureId: typeof F080_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F080OcrScansScreenshotsModuleExecutionStatus;
  readonly operationCode: typeof F080_OPERATION_CODE;
  readonly resolved_image_id: string;
  readonly resolved_recognized_text: string | number;
  readonly resolved_confidence_pct: string | number | boolean | readonly string[];
  readonly resolved_detected_table_cells: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F080OcrScansScreenshotsModuleAuditEntry;
}

export interface F080OcrScansScreenshotsModuleTelemetrySnapshot {
  readonly featureId: typeof F080_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F080_CONFIG: F080OcrScansScreenshotsModuleConfig = {
  featureId: F080_FEATURE_ID,
  stage: F080_STAGE,
  operationCode: F080_OPERATION_CODE,
  contractVersion: F080_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F080OcrScansScreenshotsModuleValidationError extends Error {
  public readonly featureId = F080_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F080 Validation Error on '${field}']: ${message}`);
    this.name = "F080OcrScansScreenshotsModuleValidationError";
    this.field = field;
  }
}

export function computeF080Digest(rawPayload: string): string {
  return `f080_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F080OcrScansScreenshotsModuleEngine {
  private readonly config: F080OcrScansScreenshotsModuleConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F080OcrScansScreenshotsModuleOutput[] = [];
  private readonly auditLog: F080OcrScansScreenshotsModuleAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F080OcrScansScreenshotsModuleOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F080OcrScansScreenshotsModuleConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F080_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F080OcrScansScreenshotsModuleConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F080OcrScansScreenshotsModuleInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F080OcrScansScreenshotsModuleValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.image_id).trim().length === 0) {
      throw new F080OcrScansScreenshotsModuleValidationError("image_id", "Primary domain attribute 'image_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      image_id: input.image_id,
      recognized_text: input.recognized_text,
      confidence_pct: input.confidence_pct,
      detected_table_cells: input.detected_table_cells
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F080OcrScansScreenshotsModuleValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F080OcrScansScreenshotsModuleInput): F080OcrScansScreenshotsModuleOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F080_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        image_id: input.image_id,
        recognized_text: input.recognized_text,
        confidence_pct: input.confidence_pct,
        detected_table_cells: input.detected_table_cells
      });
      const payloadHash = computeF080Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F080OcrScansScreenshotsModuleValidationError(
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
        featureId: F080_FEATURE_ID,
        operationCode: F080_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          image_id: input.image_id,
          recognized_text: input.recognized_text,
          confidence_pct: input.confidence_pct,
          detected_table_cells: input.detected_table_cells
        }
      });

      const executionId = `exec_f080_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f080_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F080OcrScansScreenshotsModuleAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F080_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ocr_vision_extractor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F080OcrScansScreenshotsModuleOutput = {
        featureId: F080_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F080_OPERATION_CODE,
        resolved_image_id: kernelResult.resolvedFields.image_id as string,
        resolved_recognized_text: kernelResult.resolvedFields.recognized_text as string | number,
        resolved_confidence_pct: kernelResult.resolvedFields.confidence_pct as string | number | boolean | readonly string[],
        resolved_detected_table_cells: kernelResult.resolvedFields.detected_table_cells as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F080OcrScansScreenshotsModuleTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F080_FEATURE_ID,
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

  public getAuditTrail(): readonly F080OcrScansScreenshotsModuleAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F080OcrScansScreenshotsModuleOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF080Module(): {
  featureId: typeof F080_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F080OcrScansScreenshotsModuleEngine();
  const sampleInput: F080OcrScansScreenshotsModuleInput = {
    requestId: "req_verify_f080",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    image_id: "f080_image_id_seed",
    recognized_text: 42,
    confidence_pct: true,
    detected_table_cells: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 80 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F080" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_image_id !== sampleInput.image_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F080_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
