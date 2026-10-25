/**
 * F008 (stage1-autonomy): Настраиваемые уровни автономии (L1–L5)
 * Ползунок контроля от «спрашивать каждый шаг» до «полный автопилот с отчётом по итогу»
 * Operation Code: autonomy_slider
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F008_FEATURE_ID = "F008" as const;
export const F008_STAGE = "stage1-autonomy" as const;
export const F008_OPERATION_CODE = "autonomy_slider" as const;
export const F008_CONTRACT_VERSION = "2.0.0" as const;

export type F008AutonomyLevelsL1L5ExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F008AutonomyLevelsL1L5Config {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly stage: typeof F008_STAGE;
  readonly operationCode: typeof F008_OPERATION_CODE;
  readonly contractVersion: typeof F008_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F008AutonomyLevelsL1L5Input {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tier_level: string;
  readonly cosmora_policy_code: string | number;
  readonly require_step_confirmation: string | number | boolean | readonly string[];
  readonly allow_fanout: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F008AutonomyLevelsL1L5AuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F008_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F008AutonomyLevelsL1L5Output {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F008AutonomyLevelsL1L5ExecutionStatus;
  readonly operationCode: typeof F008_OPERATION_CODE;
  readonly resolved_tier_level: string;
  readonly resolved_cosmora_policy_code: string | number;
  readonly resolved_require_step_confirmation: string | number | boolean | readonly string[];
  readonly resolved_allow_fanout: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F008AutonomyLevelsL1L5AuditEntry;
}

export interface F008AutonomyLevelsL1L5TelemetrySnapshot {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F008_CONFIG: F008AutonomyLevelsL1L5Config = {
  featureId: F008_FEATURE_ID,
  stage: F008_STAGE,
  operationCode: F008_OPERATION_CODE,
  contractVersion: F008_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F008AutonomyLevelsL1L5ValidationError extends Error {
  public readonly featureId = F008_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F008 Validation Error on '${field}']: ${message}`);
    this.name = "F008AutonomyLevelsL1L5ValidationError";
    this.field = field;
  }
}

export function computeF008Digest(rawPayload: string): string {
  return `f008_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F008AutonomyLevelsL1L5Engine {
  private readonly config: F008AutonomyLevelsL1L5Config;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F008AutonomyLevelsL1L5Output[] = [];
  private readonly auditLog: F008AutonomyLevelsL1L5AuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F008AutonomyLevelsL1L5Output }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F008AutonomyLevelsL1L5Config>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F008_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F008AutonomyLevelsL1L5Config {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F008AutonomyLevelsL1L5Input): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F008AutonomyLevelsL1L5ValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.tier_level).trim().length === 0) {
      throw new F008AutonomyLevelsL1L5ValidationError("tier_level", "Primary domain attribute 'tier_level' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      tier_level: input.tier_level,
      cosmora_policy_code: input.cosmora_policy_code,
      require_step_confirmation: input.require_step_confirmation,
      allow_fanout: input.allow_fanout
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F008AutonomyLevelsL1L5ValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F008AutonomyLevelsL1L5Input): F008AutonomyLevelsL1L5Output {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F008_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        tier_level: input.tier_level,
        cosmora_policy_code: input.cosmora_policy_code,
        require_step_confirmation: input.require_step_confirmation,
        allow_fanout: input.allow_fanout
      });
      const payloadHash = computeF008Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F008AutonomyLevelsL1L5ValidationError(
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
        featureId: F008_FEATURE_ID,
        operationCode: F008_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          tier_level: input.tier_level,
          cosmora_policy_code: input.cosmora_policy_code,
          require_step_confirmation: input.require_step_confirmation,
          allow_fanout: input.allow_fanout
        }
      });

      const executionId = `exec_f008_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f008_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F008AutonomyLevelsL1L5AuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F008_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `autonomy_slider:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F008AutonomyLevelsL1L5Output = {
        featureId: F008_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F008_OPERATION_CODE,
        resolved_tier_level: kernelResult.resolvedFields.tier_level as string,
        resolved_cosmora_policy_code: kernelResult.resolvedFields.cosmora_policy_code as string | number,
        resolved_require_step_confirmation: kernelResult.resolvedFields.require_step_confirmation as string | number | boolean | readonly string[],
        resolved_allow_fanout: kernelResult.resolvedFields.allow_fanout as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F008AutonomyLevelsL1L5TelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F008_FEATURE_ID,
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

  public getAuditTrail(): readonly F008AutonomyLevelsL1L5AuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F008AutonomyLevelsL1L5Output[] {
    return [...this.executionHistory];
  }
}

export function verifyF008Module(): {
  featureId: typeof F008_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F008AutonomyLevelsL1L5Engine();
  const sampleInput: F008AutonomyLevelsL1L5Input = {
    requestId: "req_verify_f008",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tier_level: "f008_tier_level_seed",
    cosmora_policy_code: 42,
    require_step_confirmation: true,
    allow_fanout: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 8 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F008" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tier_level !== sampleInput.tier_level &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F008_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
