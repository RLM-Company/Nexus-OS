/**
 * F068 (stage3-skills-bus): Горячая подгрузка контекста скилла (Lazy Skill Expansion)
 * Подтягивание тяжёлых инструкций скилла только в момент его реального вызова
 * Operation Code: lazy_skill_loader
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F068_FEATURE_ID = "F068" as const;
export const F068_STAGE = "stage3-skills-bus" as const;
export const F068_OPERATION_CODE = "lazy_skill_loader" as const;
export const F068_CONTRACT_VERSION = "2.0.0" as const;

export type F068LazySkillContextExpansionExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F068LazySkillContextExpansionConfig {
  readonly featureId: typeof F068_FEATURE_ID;
  readonly stage: typeof F068_STAGE;
  readonly operationCode: typeof F068_OPERATION_CODE;
  readonly contractVersion: typeof F068_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F068LazySkillContextExpansionInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly skill_handle: string;
  readonly loaded_on_demand: string | number;
  readonly tokens_saved_while_idle: string | number | boolean | readonly string[];
  readonly expanded_instructions: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F068LazySkillContextExpansionAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F068_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F068LazySkillContextExpansionOutput {
  readonly featureId: typeof F068_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F068LazySkillContextExpansionExecutionStatus;
  readonly operationCode: typeof F068_OPERATION_CODE;
  readonly resolved_skill_handle: string;
  readonly resolved_loaded_on_demand: string | number;
  readonly resolved_tokens_saved_while_idle: string | number | boolean | readonly string[];
  readonly resolved_expanded_instructions: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F068LazySkillContextExpansionAuditEntry;
}

export interface F068LazySkillContextExpansionTelemetrySnapshot {
  readonly featureId: typeof F068_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F068_CONFIG: F068LazySkillContextExpansionConfig = {
  featureId: F068_FEATURE_ID,
  stage: F068_STAGE,
  operationCode: F068_OPERATION_CODE,
  contractVersion: F068_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F068LazySkillContextExpansionValidationError extends Error {
  public readonly featureId = F068_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F068 Validation Error on '${field}']: ${message}`);
    this.name = "F068LazySkillContextExpansionValidationError";
    this.field = field;
  }
}

export function computeF068Digest(rawPayload: string): string {
  return `f068_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F068LazySkillContextExpansionEngine {
  private readonly config: F068LazySkillContextExpansionConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F068LazySkillContextExpansionOutput[] = [];
  private readonly auditLog: F068LazySkillContextExpansionAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F068LazySkillContextExpansionOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F068LazySkillContextExpansionConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F068_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F068LazySkillContextExpansionConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F068LazySkillContextExpansionInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F068LazySkillContextExpansionValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.skill_handle).trim().length === 0) {
      throw new F068LazySkillContextExpansionValidationError("skill_handle", "Primary domain attribute 'skill_handle' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      skill_handle: input.skill_handle,
      loaded_on_demand: input.loaded_on_demand,
      tokens_saved_while_idle: input.tokens_saved_while_idle,
      expanded_instructions: input.expanded_instructions
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F068LazySkillContextExpansionValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F068LazySkillContextExpansionInput): F068LazySkillContextExpansionOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F068_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        skill_handle: input.skill_handle,
        loaded_on_demand: input.loaded_on_demand,
        tokens_saved_while_idle: input.tokens_saved_while_idle,
        expanded_instructions: input.expanded_instructions
      });
      const payloadHash = computeF068Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F068LazySkillContextExpansionValidationError(
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
        featureId: F068_FEATURE_ID,
        operationCode: F068_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          skill_handle: input.skill_handle,
          loaded_on_demand: input.loaded_on_demand,
          tokens_saved_while_idle: input.tokens_saved_while_idle,
          expanded_instructions: input.expanded_instructions
        }
      });

      const executionId = `exec_f068_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f068_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F068LazySkillContextExpansionAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F068_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `lazy_skill_loader:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F068LazySkillContextExpansionOutput = {
        featureId: F068_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F068_OPERATION_CODE,
        resolved_skill_handle: kernelResult.resolvedFields.skill_handle as string,
        resolved_loaded_on_demand: kernelResult.resolvedFields.loaded_on_demand as string | number,
        resolved_tokens_saved_while_idle: kernelResult.resolvedFields.tokens_saved_while_idle as string | number | boolean | readonly string[],
        resolved_expanded_instructions: kernelResult.resolvedFields.expanded_instructions as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F068LazySkillContextExpansionTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F068_FEATURE_ID,
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

  public getAuditTrail(): readonly F068LazySkillContextExpansionAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F068LazySkillContextExpansionOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF068Module(): {
  featureId: typeof F068_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F068LazySkillContextExpansionEngine();
  const sampleInput: F068LazySkillContextExpansionInput = {
    requestId: "req_verify_f068",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_handle: "f068_skill_handle_seed",
    loaded_on_demand: 42,
    tokens_saved_while_idle: true,
    expanded_instructions: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 68 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F068" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_skill_handle !== sampleInput.skill_handle &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F068_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
