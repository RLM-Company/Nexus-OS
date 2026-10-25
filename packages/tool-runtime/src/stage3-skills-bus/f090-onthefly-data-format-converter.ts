/**
 * F090 (stage3-skills-bus): Конвертер форматов данных на лету
 * Мгновенный перевод JSON <-> CSV <-> XLSX <-> Markdown Table <-> SQL Insert
 * Operation Code: data_format_transformer
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F090_FEATURE_ID = "F090" as const;
export const F090_STAGE = "stage3-skills-bus" as const;
export const F090_OPERATION_CODE = "data_format_transformer" as const;
export const F090_CONTRACT_VERSION = "2.0.0" as const;

export type F090OntheflyDataFormatConverterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F090OntheflyDataFormatConverterConfig {
  readonly featureId: typeof F090_FEATURE_ID;
  readonly stage: typeof F090_STAGE;
  readonly operationCode: typeof F090_OPERATION_CODE;
  readonly contractVersion: typeof F090_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F090OntheflyDataFormatConverterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_format: string;
  readonly target_format: string | number;
  readonly records_converted: string | number | boolean | readonly string[];
  readonly serialized_output: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F090OntheflyDataFormatConverterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F090_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F090OntheflyDataFormatConverterOutput {
  readonly featureId: typeof F090_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F090OntheflyDataFormatConverterExecutionStatus;
  readonly operationCode: typeof F090_OPERATION_CODE;
  readonly resolved_source_format: string;
  readonly resolved_target_format: string | number;
  readonly resolved_records_converted: string | number | boolean | readonly string[];
  readonly resolved_serialized_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F090OntheflyDataFormatConverterAuditEntry;
}

export interface F090OntheflyDataFormatConverterTelemetrySnapshot {
  readonly featureId: typeof F090_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F090_CONFIG: F090OntheflyDataFormatConverterConfig = {
  featureId: F090_FEATURE_ID,
  stage: F090_STAGE,
  operationCode: F090_OPERATION_CODE,
  contractVersion: F090_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F090OntheflyDataFormatConverterValidationError extends Error {
  public readonly featureId = F090_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F090 Validation Error on '${field}']: ${message}`);
    this.name = "F090OntheflyDataFormatConverterValidationError";
    this.field = field;
  }
}

export function computeF090Digest(rawPayload: string): string {
  return `f090_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F090OntheflyDataFormatConverterEngine {
  private readonly config: F090OntheflyDataFormatConverterConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F090OntheflyDataFormatConverterOutput[] = [];
  private readonly auditLog: F090OntheflyDataFormatConverterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F090OntheflyDataFormatConverterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F090OntheflyDataFormatConverterConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F090_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F090OntheflyDataFormatConverterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F090OntheflyDataFormatConverterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F090OntheflyDataFormatConverterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.source_format).trim().length === 0) {
      throw new F090OntheflyDataFormatConverterValidationError("source_format", "Primary domain attribute 'source_format' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      source_format: input.source_format,
      target_format: input.target_format,
      records_converted: input.records_converted,
      serialized_output: input.serialized_output
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F090OntheflyDataFormatConverterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F090OntheflyDataFormatConverterInput): F090OntheflyDataFormatConverterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F090_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        source_format: input.source_format,
        target_format: input.target_format,
        records_converted: input.records_converted,
        serialized_output: input.serialized_output
      });
      const payloadHash = computeF090Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F090OntheflyDataFormatConverterValidationError(
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
        featureId: F090_FEATURE_ID,
        operationCode: F090_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          source_format: input.source_format,
          target_format: input.target_format,
          records_converted: input.records_converted,
          serialized_output: input.serialized_output
        }
      });

      const executionId = `exec_f090_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f090_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F090OntheflyDataFormatConverterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F090_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `data_format_transformer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F090OntheflyDataFormatConverterOutput = {
        featureId: F090_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F090_OPERATION_CODE,
        resolved_source_format: kernelResult.resolvedFields.source_format as string,
        resolved_target_format: kernelResult.resolvedFields.target_format as string | number,
        resolved_records_converted: kernelResult.resolvedFields.records_converted as string | number | boolean | readonly string[],
        resolved_serialized_output: kernelResult.resolvedFields.serialized_output as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F090OntheflyDataFormatConverterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F090_FEATURE_ID,
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

  public getAuditTrail(): readonly F090OntheflyDataFormatConverterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F090OntheflyDataFormatConverterOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF090Module(): {
  featureId: typeof F090_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F090OntheflyDataFormatConverterEngine();
  const sampleInput: F090OntheflyDataFormatConverterInput = {
    requestId: "req_verify_f090",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_format: "f090_source_format_seed",
    target_format: 42,
    records_converted: true,
    serialized_output: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 90 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F090" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_format !== sampleInput.source_format &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F090_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
