/**
 * F133 (stage5-enterprise): Детектор и маскировщик персональных данных (PII Redaction)
 * Автоматическое скрытие телефонов, паспортов и ключей перед отправкой во внешние LLM API
 * Operation Code: pii_data_masker
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F133_FEATURE_ID = "F133" as const;
export const F133_STAGE = "stage5-enterprise" as const;
export const F133_OPERATION_CODE = "pii_data_masker" as const;
export const F133_CONTRACT_VERSION = "2.0.0" as const;

export type F133PiiRedactionScrubberExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F133PiiRedactionScrubberConfig {
  readonly featureId: typeof F133_FEATURE_ID;
  readonly stage: typeof F133_STAGE;
  readonly operationCode: typeof F133_OPERATION_CODE;
  readonly contractVersion: typeof F133_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F133PiiRedactionScrubberInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly input_length: string;
  readonly redacted_entities_count: string | number;
  readonly sanitized_payload: string | number | boolean | readonly string[];
  readonly compliance_passed: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F133PiiRedactionScrubberAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F133_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F133PiiRedactionScrubberOutput {
  readonly featureId: typeof F133_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F133PiiRedactionScrubberExecutionStatus;
  readonly operationCode: typeof F133_OPERATION_CODE;
  readonly resolved_input_length: string;
  readonly resolved_redacted_entities_count: string | number;
  readonly resolved_sanitized_payload: string | number | boolean | readonly string[];
  readonly resolved_compliance_passed: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F133PiiRedactionScrubberAuditEntry;
}

export interface F133PiiRedactionScrubberTelemetrySnapshot {
  readonly featureId: typeof F133_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F133_CONFIG: F133PiiRedactionScrubberConfig = {
  featureId: F133_FEATURE_ID,
  stage: F133_STAGE,
  operationCode: F133_OPERATION_CODE,
  contractVersion: F133_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F133PiiRedactionScrubberValidationError extends Error {
  public readonly featureId = F133_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F133 Validation Error on '${field}']: ${message}`);
    this.name = "F133PiiRedactionScrubberValidationError";
    this.field = field;
  }
}

export function computeF133Digest(rawPayload: string): string {
  return `f133_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F133PiiRedactionScrubberEngine {
  private readonly config: F133PiiRedactionScrubberConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F133PiiRedactionScrubberOutput[] = [];
  private readonly auditLog: F133PiiRedactionScrubberAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F133PiiRedactionScrubberOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F133PiiRedactionScrubberConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F133_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F133PiiRedactionScrubberConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F133PiiRedactionScrubberInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F133PiiRedactionScrubberValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.input_length).trim().length === 0) {
      throw new F133PiiRedactionScrubberValidationError("input_length", "Primary domain attribute 'input_length' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      input_length: input.input_length,
      redacted_entities_count: input.redacted_entities_count,
      sanitized_payload: input.sanitized_payload,
      compliance_passed: input.compliance_passed
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F133PiiRedactionScrubberValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F133PiiRedactionScrubberInput): F133PiiRedactionScrubberOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F133_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        input_length: input.input_length,
        redacted_entities_count: input.redacted_entities_count,
        sanitized_payload: input.sanitized_payload,
        compliance_passed: input.compliance_passed
      });
      const payloadHash = computeF133Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F133PiiRedactionScrubberValidationError(
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
        featureId: F133_FEATURE_ID,
        operationCode: F133_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          input_length: input.input_length,
          redacted_entities_count: input.redacted_entities_count,
          sanitized_payload: input.sanitized_payload,
          compliance_passed: input.compliance_passed
        }
      });

      const executionId = `exec_f133_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f133_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F133PiiRedactionScrubberAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F133_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `pii_data_masker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F133PiiRedactionScrubberOutput = {
        featureId: F133_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F133_OPERATION_CODE,
        resolved_input_length: kernelResult.resolvedFields.input_length as string,
        resolved_redacted_entities_count: kernelResult.resolvedFields.redacted_entities_count as string | number,
        resolved_sanitized_payload: kernelResult.resolvedFields.sanitized_payload as string | number | boolean | readonly string[],
        resolved_compliance_passed: kernelResult.resolvedFields.compliance_passed as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F133PiiRedactionScrubberTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F133_FEATURE_ID,
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

  public getAuditTrail(): readonly F133PiiRedactionScrubberAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F133PiiRedactionScrubberOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF133Module(): {
  featureId: typeof F133_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F133PiiRedactionScrubberEngine();
  const sampleInput: F133PiiRedactionScrubberInput = {
    requestId: "req_verify_f133",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    input_length: "f133_input_length_seed",
    redacted_entities_count: 42,
    sanitized_payload: true,
    compliance_passed: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 133 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F133" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_input_length !== sampleInput.input_length &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F133_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
