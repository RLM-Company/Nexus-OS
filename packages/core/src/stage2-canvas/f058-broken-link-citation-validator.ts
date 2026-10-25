/**
 * F058 (stage2-canvas): Автоматическая проверка битых ссылок и сносок
 * Валидация всех цитат и источников внутри сгенерированного отчёта
 * Operation Code: citation_link_checker
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F058_FEATURE_ID = "F058" as const;
export const F058_STAGE = "stage2-canvas" as const;
export const F058_OPERATION_CODE = "citation_link_checker" as const;
export const F058_CONTRACT_VERSION = "2.0.0" as const;

export type F058BrokenLinkCitationValidatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F058BrokenLinkCitationValidatorConfig {
  readonly featureId: typeof F058_FEATURE_ID;
  readonly stage: typeof F058_STAGE;
  readonly operationCode: typeof F058_OPERATION_CODE;
  readonly contractVersion: typeof F058_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F058BrokenLinkCitationValidatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly total_links_checked: string | number;
  readonly broken_urls: string | number | boolean | readonly string[];
  readonly all_citations_valid: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F058BrokenLinkCitationValidatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F058_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F058BrokenLinkCitationValidatorOutput {
  readonly featureId: typeof F058_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F058BrokenLinkCitationValidatorExecutionStatus;
  readonly operationCode: typeof F058_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_total_links_checked: string | number;
  readonly resolved_broken_urls: string | number | boolean | readonly string[];
  readonly resolved_all_citations_valid: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F058BrokenLinkCitationValidatorAuditEntry;
}

export interface F058BrokenLinkCitationValidatorTelemetrySnapshot {
  readonly featureId: typeof F058_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F058_CONFIG: F058BrokenLinkCitationValidatorConfig = {
  featureId: F058_FEATURE_ID,
  stage: F058_STAGE,
  operationCode: F058_OPERATION_CODE,
  contractVersion: F058_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F058BrokenLinkCitationValidatorValidationError extends Error {
  public readonly featureId = F058_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F058 Validation Error on '${field}']: ${message}`);
    this.name = "F058BrokenLinkCitationValidatorValidationError";
    this.field = field;
  }
}

export function computeF058Digest(rawPayload: string): string {
  return `f058_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F058BrokenLinkCitationValidatorEngine {
  private readonly config: F058BrokenLinkCitationValidatorConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F058BrokenLinkCitationValidatorOutput[] = [];
  private readonly auditLog: F058BrokenLinkCitationValidatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F058BrokenLinkCitationValidatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F058BrokenLinkCitationValidatorConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F058_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F058BrokenLinkCitationValidatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F058BrokenLinkCitationValidatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F058BrokenLinkCitationValidatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F058BrokenLinkCitationValidatorValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      total_links_checked: input.total_links_checked,
      broken_urls: input.broken_urls,
      all_citations_valid: input.all_citations_valid
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F058BrokenLinkCitationValidatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F058BrokenLinkCitationValidatorInput): F058BrokenLinkCitationValidatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F058_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        total_links_checked: input.total_links_checked,
        broken_urls: input.broken_urls,
        all_citations_valid: input.all_citations_valid
      });
      const payloadHash = computeF058Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F058BrokenLinkCitationValidatorValidationError(
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
        featureId: F058_FEATURE_ID,
        operationCode: F058_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          total_links_checked: input.total_links_checked,
          broken_urls: input.broken_urls,
          all_citations_valid: input.all_citations_valid
        }
      });

      const executionId = `exec_f058_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f058_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F058BrokenLinkCitationValidatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F058_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `citation_link_checker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F058BrokenLinkCitationValidatorOutput = {
        featureId: F058_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F058_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_total_links_checked: kernelResult.resolvedFields.total_links_checked as string | number,
        resolved_broken_urls: kernelResult.resolvedFields.broken_urls as string | number | boolean | readonly string[],
        resolved_all_citations_valid: kernelResult.resolvedFields.all_citations_valid as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F058BrokenLinkCitationValidatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F058_FEATURE_ID,
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

  public getAuditTrail(): readonly F058BrokenLinkCitationValidatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F058BrokenLinkCitationValidatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF058Module(): {
  featureId: typeof F058_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F058BrokenLinkCitationValidatorEngine();
  const sampleInput: F058BrokenLinkCitationValidatorInput = {
    requestId: "req_verify_f058",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f058_artifact_id_seed",
    total_links_checked: 42,
    broken_urls: true,
    all_citations_valid: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 58 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F058" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F058_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
