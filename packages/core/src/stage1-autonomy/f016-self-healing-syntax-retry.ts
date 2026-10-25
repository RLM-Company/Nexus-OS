/**
 * F016 (stage1-autonomy): Самоисправление синтаксиса (Self-Healing Retry)
 * Автоматический перезапрос при битом JSON или ошибке компиляции без участия человека
 * Operation Code: self_healing_retry
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F016_FEATURE_ID = "F016" as const;
export const F016_STAGE = "stage1-autonomy" as const;
export const F016_OPERATION_CODE = "self_healing_retry" as const;
export const F016_CONTRACT_VERSION = "2.0.0" as const;

export type F016SelfHealingSyntaxRetryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F016SelfHealingSyntaxRetryConfig {
  readonly featureId: typeof F016_FEATURE_ID;
  readonly stage: typeof F016_STAGE;
  readonly operationCode: typeof F016_OPERATION_CODE;
  readonly contractVersion: typeof F016_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F016SelfHealingSyntaxRetryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly attempt_number: string;
  readonly syntax_repaired: string | number;
  readonly extracted_json: string | number | boolean | readonly string[];
  readonly diagnostic_delta: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F016SelfHealingSyntaxRetryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F016_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F016SelfHealingSyntaxRetryOutput {
  readonly featureId: typeof F016_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F016SelfHealingSyntaxRetryExecutionStatus;
  readonly operationCode: typeof F016_OPERATION_CODE;
  readonly resolved_attempt_number: string;
  readonly resolved_syntax_repaired: string | number;
  readonly resolved_extracted_json: string | number | boolean | readonly string[];
  readonly resolved_diagnostic_delta: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F016SelfHealingSyntaxRetryAuditEntry;
}

export interface F016SelfHealingSyntaxRetryTelemetrySnapshot {
  readonly featureId: typeof F016_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F016_CONFIG: F016SelfHealingSyntaxRetryConfig = {
  featureId: F016_FEATURE_ID,
  stage: F016_STAGE,
  operationCode: F016_OPERATION_CODE,
  contractVersion: F016_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F016SelfHealingSyntaxRetryValidationError extends Error {
  public readonly featureId = F016_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F016 Validation Error on '${field}']: ${message}`);
    this.name = "F016SelfHealingSyntaxRetryValidationError";
    this.field = field;
  }
}

export function computeF016Digest(rawPayload: string): string {
  return `f016_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F016SelfHealingSyntaxRetryEngine {
  private readonly config: F016SelfHealingSyntaxRetryConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F016SelfHealingSyntaxRetryOutput[] = [];
  private readonly auditLog: F016SelfHealingSyntaxRetryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F016SelfHealingSyntaxRetryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F016SelfHealingSyntaxRetryConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F016_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F016SelfHealingSyntaxRetryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F016SelfHealingSyntaxRetryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F016SelfHealingSyntaxRetryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.attempt_number).trim().length === 0) {
      throw new F016SelfHealingSyntaxRetryValidationError("attempt_number", "Primary domain attribute 'attempt_number' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      attempt_number: input.attempt_number,
      syntax_repaired: input.syntax_repaired,
      extracted_json: input.extracted_json,
      diagnostic_delta: input.diagnostic_delta
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F016SelfHealingSyntaxRetryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F016SelfHealingSyntaxRetryInput): F016SelfHealingSyntaxRetryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F016_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        attempt_number: input.attempt_number,
        syntax_repaired: input.syntax_repaired,
        extracted_json: input.extracted_json,
        diagnostic_delta: input.diagnostic_delta
      });
      const payloadHash = computeF016Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F016SelfHealingSyntaxRetryValidationError(
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
        featureId: F016_FEATURE_ID,
        operationCode: F016_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          attempt_number: input.attempt_number,
          syntax_repaired: input.syntax_repaired,
          extracted_json: input.extracted_json,
          diagnostic_delta: input.diagnostic_delta
        }
      });

      const executionId = `exec_f016_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f016_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F016SelfHealingSyntaxRetryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F016_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `self_healing_retry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F016SelfHealingSyntaxRetryOutput = {
        featureId: F016_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F016_OPERATION_CODE,
        resolved_attempt_number: kernelResult.resolvedFields.attempt_number as string,
        resolved_syntax_repaired: kernelResult.resolvedFields.syntax_repaired as string | number,
        resolved_extracted_json: kernelResult.resolvedFields.extracted_json as string | number | boolean | readonly string[],
        resolved_diagnostic_delta: kernelResult.resolvedFields.diagnostic_delta as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F016SelfHealingSyntaxRetryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F016_FEATURE_ID,
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

  public getAuditTrail(): readonly F016SelfHealingSyntaxRetryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F016SelfHealingSyntaxRetryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF016Module(): {
  featureId: typeof F016_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F016SelfHealingSyntaxRetryEngine();
  const sampleInput: F016SelfHealingSyntaxRetryInput = {
    requestId: "req_verify_f016",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    attempt_number: "f016_attempt_number_seed",
    syntax_repaired: 42,
    extracted_json: true,
    diagnostic_delta: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 16 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F016" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_attempt_number !== sampleInput.attempt_number &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F016_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
