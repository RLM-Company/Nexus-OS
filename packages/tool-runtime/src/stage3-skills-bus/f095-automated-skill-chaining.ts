/**
 * F095 (stage3-skills-bus): Цепочки скиллов (Skill Chaining)
 * Автоматическая передача выхода одного скилла на вход другому
 * Operation Code: skill_pipeline_chainer
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F095_FEATURE_ID = "F095" as const;
export const F095_STAGE = "stage3-skills-bus" as const;
export const F095_OPERATION_CODE = "skill_pipeline_chainer" as const;
export const F095_CONTRACT_VERSION = "2.0.0" as const;

export type F095AutomatedSkillChainingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F095AutomatedSkillChainingConfig {
  readonly featureId: typeof F095_FEATURE_ID;
  readonly stage: typeof F095_STAGE;
  readonly operationCode: typeof F095_OPERATION_CODE;
  readonly contractVersion: typeof F095_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F095AutomatedSkillChainingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly chain_id: string;
  readonly ordered_skill_handles: string | number;
  readonly intermediate_artifacts: string | number | boolean | readonly string[];
  readonly final_payload: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F095AutomatedSkillChainingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F095_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F095AutomatedSkillChainingOutput {
  readonly featureId: typeof F095_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F095AutomatedSkillChainingExecutionStatus;
  readonly operationCode: typeof F095_OPERATION_CODE;
  readonly resolved_chain_id: string;
  readonly resolved_ordered_skill_handles: string | number;
  readonly resolved_intermediate_artifacts: string | number | boolean | readonly string[];
  readonly resolved_final_payload: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F095AutomatedSkillChainingAuditEntry;
}

export interface F095AutomatedSkillChainingTelemetrySnapshot {
  readonly featureId: typeof F095_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F095_CONFIG: F095AutomatedSkillChainingConfig = {
  featureId: F095_FEATURE_ID,
  stage: F095_STAGE,
  operationCode: F095_OPERATION_CODE,
  contractVersion: F095_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F095AutomatedSkillChainingValidationError extends Error {
  public readonly featureId = F095_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F095 Validation Error on '${field}']: ${message}`);
    this.name = "F095AutomatedSkillChainingValidationError";
    this.field = field;
  }
}

export function computeF095Digest(rawPayload: string): string {
  return `f095_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F095AutomatedSkillChainingEngine {
  private readonly config: F095AutomatedSkillChainingConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F095AutomatedSkillChainingOutput[] = [];
  private readonly auditLog: F095AutomatedSkillChainingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F095AutomatedSkillChainingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F095AutomatedSkillChainingConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F095_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F095AutomatedSkillChainingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F095AutomatedSkillChainingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F095AutomatedSkillChainingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.chain_id).trim().length === 0) {
      throw new F095AutomatedSkillChainingValidationError("chain_id", "Primary domain attribute 'chain_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      chain_id: input.chain_id,
      ordered_skill_handles: input.ordered_skill_handles,
      intermediate_artifacts: input.intermediate_artifacts,
      final_payload: input.final_payload
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F095AutomatedSkillChainingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F095AutomatedSkillChainingInput): F095AutomatedSkillChainingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F095_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        chain_id: input.chain_id,
        ordered_skill_handles: input.ordered_skill_handles,
        intermediate_artifacts: input.intermediate_artifacts,
        final_payload: input.final_payload
      });
      const payloadHash = computeF095Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F095AutomatedSkillChainingValidationError(
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
        featureId: F095_FEATURE_ID,
        operationCode: F095_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          chain_id: input.chain_id,
          ordered_skill_handles: input.ordered_skill_handles,
          intermediate_artifacts: input.intermediate_artifacts,
          final_payload: input.final_payload
        }
      });

      const executionId = `exec_f095_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f095_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F095AutomatedSkillChainingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F095_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `skill_pipeline_chainer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F095AutomatedSkillChainingOutput = {
        featureId: F095_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F095_OPERATION_CODE,
        resolved_chain_id: kernelResult.resolvedFields.chain_id as string,
        resolved_ordered_skill_handles: kernelResult.resolvedFields.ordered_skill_handles as string | number,
        resolved_intermediate_artifacts: kernelResult.resolvedFields.intermediate_artifacts as string | number | boolean | readonly string[],
        resolved_final_payload: kernelResult.resolvedFields.final_payload as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F095AutomatedSkillChainingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F095_FEATURE_ID,
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

  public getAuditTrail(): readonly F095AutomatedSkillChainingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F095AutomatedSkillChainingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF095Module(): {
  featureId: typeof F095_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F095AutomatedSkillChainingEngine();
  const sampleInput: F095AutomatedSkillChainingInput = {
    requestId: "req_verify_f095",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    chain_id: "f095_chain_id_seed",
    ordered_skill_handles: 42,
    intermediate_artifacts: true,
    final_payload: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 95 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F095" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_chain_id !== sampleInput.chain_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F095_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
