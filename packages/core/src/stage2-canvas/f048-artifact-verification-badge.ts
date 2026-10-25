/**
 * F048 (stage2-canvas): Бейдж статуса проверки на артефакте
 * Визуальный индикатор в шапке Canvas: проверено Критиком, есть замечания или редактируется вручную
 * Operation Code: verification_badge_ui
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F048_FEATURE_ID = "F048" as const;
export const F048_STAGE = "stage2-canvas" as const;
export const F048_OPERATION_CODE = "verification_badge_ui" as const;
export const F048_CONTRACT_VERSION = "2.0.0" as const;

export type F048ArtifactVerificationBadgeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F048ArtifactVerificationBadgeConfig {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly stage: typeof F048_STAGE;
  readonly operationCode: typeof F048_OPERATION_CODE;
  readonly contractVersion: typeof F048_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F048ArtifactVerificationBadgeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly badge_state: string | number;
  readonly critic_score: string | number | boolean | readonly string[];
  readonly badge_color_token: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F048ArtifactVerificationBadgeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F048_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F048ArtifactVerificationBadgeOutput {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F048ArtifactVerificationBadgeExecutionStatus;
  readonly operationCode: typeof F048_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_badge_state: string | number;
  readonly resolved_critic_score: string | number | boolean | readonly string[];
  readonly resolved_badge_color_token: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F048ArtifactVerificationBadgeAuditEntry;
}

export interface F048ArtifactVerificationBadgeTelemetrySnapshot {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F048_CONFIG: F048ArtifactVerificationBadgeConfig = {
  featureId: F048_FEATURE_ID,
  stage: F048_STAGE,
  operationCode: F048_OPERATION_CODE,
  contractVersion: F048_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F048ArtifactVerificationBadgeValidationError extends Error {
  public readonly featureId = F048_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F048 Validation Error on '${field}']: ${message}`);
    this.name = "F048ArtifactVerificationBadgeValidationError";
    this.field = field;
  }
}

export function computeF048Digest(rawPayload: string): string {
  return `f048_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F048ArtifactVerificationBadgeEngine {
  private readonly config: F048ArtifactVerificationBadgeConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F048ArtifactVerificationBadgeOutput[] = [];
  private readonly auditLog: F048ArtifactVerificationBadgeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F048ArtifactVerificationBadgeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F048ArtifactVerificationBadgeConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F048_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F048ArtifactVerificationBadgeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F048ArtifactVerificationBadgeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F048ArtifactVerificationBadgeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F048ArtifactVerificationBadgeValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      badge_state: input.badge_state,
      critic_score: input.critic_score,
      badge_color_token: input.badge_color_token
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F048ArtifactVerificationBadgeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F048ArtifactVerificationBadgeInput): F048ArtifactVerificationBadgeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F048_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        badge_state: input.badge_state,
        critic_score: input.critic_score,
        badge_color_token: input.badge_color_token
      });
      const payloadHash = computeF048Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F048ArtifactVerificationBadgeValidationError(
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
        featureId: F048_FEATURE_ID,
        operationCode: F048_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          badge_state: input.badge_state,
          critic_score: input.critic_score,
          badge_color_token: input.badge_color_token
        }
      });

      const executionId = `exec_f048_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f048_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F048ArtifactVerificationBadgeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F048_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `verification_badge_ui:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F048ArtifactVerificationBadgeOutput = {
        featureId: F048_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F048_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_badge_state: kernelResult.resolvedFields.badge_state as string | number,
        resolved_critic_score: kernelResult.resolvedFields.critic_score as string | number | boolean | readonly string[],
        resolved_badge_color_token: kernelResult.resolvedFields.badge_color_token as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F048ArtifactVerificationBadgeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F048_FEATURE_ID,
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

  public getAuditTrail(): readonly F048ArtifactVerificationBadgeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F048ArtifactVerificationBadgeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF048Module(): {
  featureId: typeof F048_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F048ArtifactVerificationBadgeEngine();
  const sampleInput: F048ArtifactVerificationBadgeInput = {
    requestId: "req_verify_f048",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f048_artifact_id_seed",
    badge_state: 42,
    critic_score: true,
    badge_color_token: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 48 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F048" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F048_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
