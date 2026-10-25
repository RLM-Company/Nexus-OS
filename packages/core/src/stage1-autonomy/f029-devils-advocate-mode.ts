/**
 * F029 (stage1-autonomy): Режим «Адвокат дьявола»
 * Принудительный запуск агента-оппонента для поиска слабых мест в бизнес-плане или архитектуре
 * Operation Code: redteam_challenger
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F029_FEATURE_ID = "F029" as const;
export const F029_STAGE = "stage1-autonomy" as const;
export const F029_OPERATION_CODE = "redteam_challenger" as const;
export const F029_CONTRACT_VERSION = "2.0.0" as const;

export type F029DevilsAdvocateModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F029DevilsAdvocateModeConfig {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly stage: typeof F029_STAGE;
  readonly operationCode: typeof F029_OPERATION_CODE;
  readonly contractVersion: typeof F029_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F029DevilsAdvocateModeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly challenge_id: string;
  readonly target_artifact_id: string | number;
  readonly vulnerabilities_found: string | number | boolean | readonly string[];
  readonly counter_arguments: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F029DevilsAdvocateModeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F029_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F029DevilsAdvocateModeOutput {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F029DevilsAdvocateModeExecutionStatus;
  readonly operationCode: typeof F029_OPERATION_CODE;
  readonly resolved_challenge_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_vulnerabilities_found: string | number | boolean | readonly string[];
  readonly resolved_counter_arguments: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F029DevilsAdvocateModeAuditEntry;
}

export interface F029DevilsAdvocateModeTelemetrySnapshot {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F029_CONFIG: F029DevilsAdvocateModeConfig = {
  featureId: F029_FEATURE_ID,
  stage: F029_STAGE,
  operationCode: F029_OPERATION_CODE,
  contractVersion: F029_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F029DevilsAdvocateModeValidationError extends Error {
  public readonly featureId = F029_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F029 Validation Error on '${field}']: ${message}`);
    this.name = "F029DevilsAdvocateModeValidationError";
    this.field = field;
  }
}

export function computeF029Digest(rawPayload: string): string {
  return `f029_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F029DevilsAdvocateModeEngine {
  private readonly config: F029DevilsAdvocateModeConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F029DevilsAdvocateModeOutput[] = [];
  private readonly auditLog: F029DevilsAdvocateModeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F029DevilsAdvocateModeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F029DevilsAdvocateModeConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F029_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F029DevilsAdvocateModeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F029DevilsAdvocateModeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F029DevilsAdvocateModeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.challenge_id).trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("challenge_id", "Primary domain attribute 'challenge_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      challenge_id: input.challenge_id,
      target_artifact_id: input.target_artifact_id,
      vulnerabilities_found: input.vulnerabilities_found,
      counter_arguments: input.counter_arguments
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F029DevilsAdvocateModeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F029DevilsAdvocateModeInput): F029DevilsAdvocateModeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F029_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        challenge_id: input.challenge_id,
        target_artifact_id: input.target_artifact_id,
        vulnerabilities_found: input.vulnerabilities_found,
        counter_arguments: input.counter_arguments
      });
      const payloadHash = computeF029Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F029DevilsAdvocateModeValidationError(
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
        featureId: F029_FEATURE_ID,
        operationCode: F029_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          challenge_id: input.challenge_id,
          target_artifact_id: input.target_artifact_id,
          vulnerabilities_found: input.vulnerabilities_found,
          counter_arguments: input.counter_arguments
        }
      });

      const executionId = `exec_f029_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f029_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F029DevilsAdvocateModeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F029_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `redteam_challenger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F029DevilsAdvocateModeOutput = {
        featureId: F029_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F029_OPERATION_CODE,
        resolved_challenge_id: kernelResult.resolvedFields.challenge_id as string,
        resolved_target_artifact_id: kernelResult.resolvedFields.target_artifact_id as string | number,
        resolved_vulnerabilities_found: kernelResult.resolvedFields.vulnerabilities_found as string | number | boolean | readonly string[],
        resolved_counter_arguments: kernelResult.resolvedFields.counter_arguments as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F029DevilsAdvocateModeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F029_FEATURE_ID,
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

  public getAuditTrail(): readonly F029DevilsAdvocateModeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F029DevilsAdvocateModeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF029Module(): {
  featureId: typeof F029_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F029DevilsAdvocateModeEngine();
  const sampleInput: F029DevilsAdvocateModeInput = {
    requestId: "req_verify_f029",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    challenge_id: "f029_challenge_id_seed",
    target_artifact_id: 42,
    vulnerabilities_found: true,
    counter_arguments: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 29 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F029" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_challenge_id !== sampleInput.challenge_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F029_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
