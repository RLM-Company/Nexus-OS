/**
 * F134 (stage5-enterprise): Защита от Prompt Injection и Jailbreak
 * Входной фильтр, блокирующий попытки переопределить системные инструкции через файлы или веб
 * Operation Code: injection_shield_filter
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F134_FEATURE_ID = "F134" as const;
export const F134_STAGE = "stage5-enterprise" as const;
export const F134_OPERATION_CODE = "injection_shield_filter" as const;
export const F134_CONTRACT_VERSION = "2.0.0" as const;

export type F134PromptInjectionJailbreakGuardExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F134PromptInjectionJailbreakGuardConfig {
  readonly featureId: typeof F134_FEATURE_ID;
  readonly stage: typeof F134_STAGE;
  readonly operationCode: typeof F134_OPERATION_CODE;
  readonly contractVersion: typeof F134_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F134PromptInjectionJailbreakGuardInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_channel: string;
  readonly threat_signature_detected: string | number;
  readonly blocked_execution: string | number | boolean | readonly string[];
  readonly sanitized_input: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F134PromptInjectionJailbreakGuardAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F134_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F134PromptInjectionJailbreakGuardOutput {
  readonly featureId: typeof F134_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F134PromptInjectionJailbreakGuardExecutionStatus;
  readonly operationCode: typeof F134_OPERATION_CODE;
  readonly resolved_source_channel: string;
  readonly resolved_threat_signature_detected: string | number;
  readonly resolved_blocked_execution: string | number | boolean | readonly string[];
  readonly resolved_sanitized_input: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F134PromptInjectionJailbreakGuardAuditEntry;
}

export interface F134PromptInjectionJailbreakGuardTelemetrySnapshot {
  readonly featureId: typeof F134_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F134_CONFIG: F134PromptInjectionJailbreakGuardConfig = {
  featureId: F134_FEATURE_ID,
  stage: F134_STAGE,
  operationCode: F134_OPERATION_CODE,
  contractVersion: F134_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F134PromptInjectionJailbreakGuardValidationError extends Error {
  public readonly featureId = F134_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F134 Validation Error on '${field}']: ${message}`);
    this.name = "F134PromptInjectionJailbreakGuardValidationError";
    this.field = field;
  }
}

export function computeF134Digest(rawPayload: string): string {
  return `f134_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F134PromptInjectionJailbreakGuardEngine {
  private readonly config: F134PromptInjectionJailbreakGuardConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F134PromptInjectionJailbreakGuardOutput[] = [];
  private readonly auditLog: F134PromptInjectionJailbreakGuardAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F134PromptInjectionJailbreakGuardOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F134PromptInjectionJailbreakGuardConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F134_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F134PromptInjectionJailbreakGuardConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F134PromptInjectionJailbreakGuardInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F134PromptInjectionJailbreakGuardValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.source_channel).trim().length === 0) {
      throw new F134PromptInjectionJailbreakGuardValidationError("source_channel", "Primary domain attribute 'source_channel' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      source_channel: input.source_channel,
      threat_signature_detected: input.threat_signature_detected,
      blocked_execution: input.blocked_execution,
      sanitized_input: input.sanitized_input
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F134PromptInjectionJailbreakGuardValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F134PromptInjectionJailbreakGuardInput): F134PromptInjectionJailbreakGuardOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F134_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        source_channel: input.source_channel,
        threat_signature_detected: input.threat_signature_detected,
        blocked_execution: input.blocked_execution,
        sanitized_input: input.sanitized_input
      });
      const payloadHash = computeF134Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F134PromptInjectionJailbreakGuardValidationError(
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
        featureId: F134_FEATURE_ID,
        operationCode: F134_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          source_channel: input.source_channel,
          threat_signature_detected: input.threat_signature_detected,
          blocked_execution: input.blocked_execution,
          sanitized_input: input.sanitized_input
        }
      });

      const executionId = `exec_f134_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f134_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F134PromptInjectionJailbreakGuardAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F134_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `injection_shield_filter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F134PromptInjectionJailbreakGuardOutput = {
        featureId: F134_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F134_OPERATION_CODE,
        resolved_source_channel: kernelResult.resolvedFields.source_channel as string,
        resolved_threat_signature_detected: kernelResult.resolvedFields.threat_signature_detected as string | number,
        resolved_blocked_execution: kernelResult.resolvedFields.blocked_execution as string | number | boolean | readonly string[],
        resolved_sanitized_input: kernelResult.resolvedFields.sanitized_input as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F134PromptInjectionJailbreakGuardTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F134_FEATURE_ID,
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

  public getAuditTrail(): readonly F134PromptInjectionJailbreakGuardAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F134PromptInjectionJailbreakGuardOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF134Module(): {
  featureId: typeof F134_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F134PromptInjectionJailbreakGuardEngine();
  const sampleInput: F134PromptInjectionJailbreakGuardInput = {
    requestId: "req_verify_f134",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_channel: "f134_source_channel_seed",
    threat_signature_detected: 42,
    blocked_execution: true,
    sanitized_input: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 134 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F134" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_channel !== sampleInput.source_channel &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F134_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
