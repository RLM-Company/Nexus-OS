/**
 * F088 (stage3-skills-bus): Валидатор исходящих ссылок и API-ключей
 * Проверка доступности эндпоинтов перед запуском длинной цепочки
 * Operation Code: preflight_endpoint_checker
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F088_FEATURE_ID = "F088" as const;
export const F088_STAGE = "stage3-skills-bus" as const;
export const F088_OPERATION_CODE = "preflight_endpoint_checker" as const;
export const F088_CONTRACT_VERSION = "2.0.0" as const;

export type F088OutgoingLinkApikeyValidatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F088OutgoingLinkApikeyValidatorConfig {
  readonly featureId: typeof F088_FEATURE_ID;
  readonly stage: typeof F088_STAGE;
  readonly operationCode: typeof F088_OPERATION_CODE;
  readonly contractVersion: typeof F088_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F088OutgoingLinkApikeyValidatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly endpoint_id: string;
  readonly key_format_valid: string | number;
  readonly reachable: string | number | boolean | readonly string[];
  readonly preflight_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F088OutgoingLinkApikeyValidatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F088_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F088OutgoingLinkApikeyValidatorOutput {
  readonly featureId: typeof F088_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F088OutgoingLinkApikeyValidatorExecutionStatus;
  readonly operationCode: typeof F088_OPERATION_CODE;
  readonly resolved_endpoint_id: string;
  readonly resolved_key_format_valid: string | number;
  readonly resolved_reachable: string | number | boolean | readonly string[];
  readonly resolved_preflight_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F088OutgoingLinkApikeyValidatorAuditEntry;
}

export interface F088OutgoingLinkApikeyValidatorTelemetrySnapshot {
  readonly featureId: typeof F088_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F088_CONFIG: F088OutgoingLinkApikeyValidatorConfig = {
  featureId: F088_FEATURE_ID,
  stage: F088_STAGE,
  operationCode: F088_OPERATION_CODE,
  contractVersion: F088_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F088OutgoingLinkApikeyValidatorValidationError extends Error {
  public readonly featureId = F088_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F088 Validation Error on '${field}']: ${message}`);
    this.name = "F088OutgoingLinkApikeyValidatorValidationError";
    this.field = field;
  }
}

export function computeF088Digest(rawPayload: string): string {
  return `f088_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F088OutgoingLinkApikeyValidatorEngine {
  private readonly config: F088OutgoingLinkApikeyValidatorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F088OutgoingLinkApikeyValidatorOutput[] = [];
  private readonly auditLog: F088OutgoingLinkApikeyValidatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F088OutgoingLinkApikeyValidatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F088OutgoingLinkApikeyValidatorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F088_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F088OutgoingLinkApikeyValidatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F088OutgoingLinkApikeyValidatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.endpoint_id).trim().length === 0) {
      throw new F088OutgoingLinkApikeyValidatorValidationError("endpoint_id", "Primary domain attribute 'endpoint_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      endpoint_id: input.endpoint_id,
      key_format_valid: input.key_format_valid,
      reachable: input.reachable,
      preflight_latency_ms: input.preflight_latency_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F088OutgoingLinkApikeyValidatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F088OutgoingLinkApikeyValidatorInput): F088OutgoingLinkApikeyValidatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F088_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        endpoint_id: input.endpoint_id,
        key_format_valid: input.key_format_valid,
        reachable: input.reachable,
        preflight_latency_ms: input.preflight_latency_ms
      });
      const payloadHash = computeF088Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F088OutgoingLinkApikeyValidatorValidationError(
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
        featureId: F088_FEATURE_ID,
        operationCode: F088_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          endpoint_id: input.endpoint_id,
          key_format_valid: input.key_format_valid,
          reachable: input.reachable,
          preflight_latency_ms: input.preflight_latency_ms
        }
      });

      const executionId = `exec_f088_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f088_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F088OutgoingLinkApikeyValidatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F088_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `preflight_endpoint_checker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F088OutgoingLinkApikeyValidatorOutput = {
        featureId: F088_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F088_OPERATION_CODE,
        resolved_endpoint_id: kernelResult.resolvedFields.endpoint_id as string,
        resolved_key_format_valid: kernelResult.resolvedFields.key_format_valid as string | number,
        resolved_reachable: kernelResult.resolvedFields.reachable as string | number | boolean | readonly string[],
        resolved_preflight_latency_ms: kernelResult.resolvedFields.preflight_latency_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F088OutgoingLinkApikeyValidatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F088_FEATURE_ID,
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

  public getAuditTrail(): readonly F088OutgoingLinkApikeyValidatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F088OutgoingLinkApikeyValidatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF088Module(): {
  featureId: typeof F088_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F088OutgoingLinkApikeyValidatorEngine();
  const sampleInput: F088OutgoingLinkApikeyValidatorInput = {
    requestId: "req_verify_f088",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    endpoint_id: "f088_endpoint_id_seed",
    key_format_valid: 42,
    reachable: true,
    preflight_latency_ms: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 88 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F088" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_endpoint_id !== sampleInput.endpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F088_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
