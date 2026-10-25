/**
 * F067 (stage3-skills-bus): Конструктор кастомных Skills
 * Упаковка успешного промпт-пайплайна и набора скриптов в переиспользуемый скилл
 * Operation Code: skill_packager
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F067_FEATURE_ID = "F067" as const;
export const F067_STAGE = "stage3-skills-bus" as const;
export const F067_OPERATION_CODE = "skill_packager" as const;
export const F067_CONTRACT_VERSION = "2.0.0" as const;

export type F067CustomSkillBuilderExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F067CustomSkillBuilderConfig {
  readonly featureId: typeof F067_FEATURE_ID;
  readonly stage: typeof F067_STAGE;
  readonly operationCode: typeof F067_OPERATION_CODE;
  readonly contractVersion: typeof F067_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F067CustomSkillBuilderInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly custom_skill_id: string;
  readonly pipeline_steps: string | number;
  readonly manifest_valid: string | number | boolean | readonly string[];
  readonly packaged_bundle: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F067CustomSkillBuilderAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F067_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F067CustomSkillBuilderOutput {
  readonly featureId: typeof F067_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F067CustomSkillBuilderExecutionStatus;
  readonly operationCode: typeof F067_OPERATION_CODE;
  readonly resolved_custom_skill_id: string;
  readonly resolved_pipeline_steps: string | number;
  readonly resolved_manifest_valid: string | number | boolean | readonly string[];
  readonly resolved_packaged_bundle: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F067CustomSkillBuilderAuditEntry;
}

export interface F067CustomSkillBuilderTelemetrySnapshot {
  readonly featureId: typeof F067_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F067_CONFIG: F067CustomSkillBuilderConfig = {
  featureId: F067_FEATURE_ID,
  stage: F067_STAGE,
  operationCode: F067_OPERATION_CODE,
  contractVersion: F067_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F067CustomSkillBuilderValidationError extends Error {
  public readonly featureId = F067_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F067 Validation Error on '${field}']: ${message}`);
    this.name = "F067CustomSkillBuilderValidationError";
    this.field = field;
  }
}

export function computeF067Digest(rawPayload: string): string {
  return `f067_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F067CustomSkillBuilderEngine {
  private readonly config: F067CustomSkillBuilderConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F067CustomSkillBuilderOutput[] = [];
  private readonly auditLog: F067CustomSkillBuilderAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F067CustomSkillBuilderOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F067CustomSkillBuilderConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F067_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F067CustomSkillBuilderConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F067CustomSkillBuilderInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F067CustomSkillBuilderValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.custom_skill_id).trim().length === 0) {
      throw new F067CustomSkillBuilderValidationError("custom_skill_id", "Primary domain attribute 'custom_skill_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      custom_skill_id: input.custom_skill_id,
      pipeline_steps: input.pipeline_steps,
      manifest_valid: input.manifest_valid,
      packaged_bundle: input.packaged_bundle
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F067CustomSkillBuilderValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F067CustomSkillBuilderInput): F067CustomSkillBuilderOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F067_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        custom_skill_id: input.custom_skill_id,
        pipeline_steps: input.pipeline_steps,
        manifest_valid: input.manifest_valid,
        packaged_bundle: input.packaged_bundle
      });
      const payloadHash = computeF067Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F067CustomSkillBuilderValidationError(
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
        featureId: F067_FEATURE_ID,
        operationCode: F067_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          custom_skill_id: input.custom_skill_id,
          pipeline_steps: input.pipeline_steps,
          manifest_valid: input.manifest_valid,
          packaged_bundle: input.packaged_bundle
        }
      });

      const executionId = `exec_f067_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f067_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F067CustomSkillBuilderAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F067_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `skill_packager:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F067CustomSkillBuilderOutput = {
        featureId: F067_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F067_OPERATION_CODE,
        resolved_custom_skill_id: kernelResult.resolvedFields.custom_skill_id as string,
        resolved_pipeline_steps: kernelResult.resolvedFields.pipeline_steps as string | number,
        resolved_manifest_valid: kernelResult.resolvedFields.manifest_valid as string | number | boolean | readonly string[],
        resolved_packaged_bundle: kernelResult.resolvedFields.packaged_bundle as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F067CustomSkillBuilderTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F067_FEATURE_ID,
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

  public getAuditTrail(): readonly F067CustomSkillBuilderAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F067CustomSkillBuilderOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF067Module(): {
  featureId: typeof F067_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F067CustomSkillBuilderEngine();
  const sampleInput: F067CustomSkillBuilderInput = {
    requestId: "req_verify_f067",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    custom_skill_id: "f067_custom_skill_id_seed",
    pipeline_steps: 42,
    manifest_valid: true,
    packaged_bundle: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 67 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F067" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_custom_skill_id !== sampleInput.custom_skill_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F067_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
