/**
 * F009 (stage1-autonomy): Роутер моделей (Dynamic LLM Routing)
 * Распределение простых задач на быстрые модели и сложных архитектурных узлов на флагманские модели
 * Operation Code: llm_router
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F009_FEATURE_ID = "F009" as const;
export const F009_STAGE = "stage1-autonomy" as const;
export const F009_OPERATION_CODE = "llm_router" as const;
export const F009_CONTRACT_VERSION = "2.0.0" as const;

export type F009DynamicLlmRoutingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F009DynamicLlmRoutingConfig {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly stage: typeof F009_STAGE;
  readonly operationCode: typeof F009_OPERATION_CODE;
  readonly contractVersion: typeof F009_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F009DynamicLlmRoutingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly route_id: string;
  readonly selected_model: string | number;
  readonly complexity_tier: string | number | boolean | readonly string[];
  readonly estimated_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F009DynamicLlmRoutingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F009_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F009DynamicLlmRoutingOutput {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F009DynamicLlmRoutingExecutionStatus;
  readonly operationCode: typeof F009_OPERATION_CODE;
  readonly resolved_route_id: string;
  readonly resolved_selected_model: string | number;
  readonly resolved_complexity_tier: string | number | boolean | readonly string[];
  readonly resolved_estimated_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F009DynamicLlmRoutingAuditEntry;
}

export interface F009DynamicLlmRoutingTelemetrySnapshot {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F009_CONFIG: F009DynamicLlmRoutingConfig = {
  featureId: F009_FEATURE_ID,
  stage: F009_STAGE,
  operationCode: F009_OPERATION_CODE,
  contractVersion: F009_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F009DynamicLlmRoutingValidationError extends Error {
  public readonly featureId = F009_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F009 Validation Error on '${field}']: ${message}`);
    this.name = "F009DynamicLlmRoutingValidationError";
    this.field = field;
  }
}

export function computeF009Digest(rawPayload: string): string {
  return `f009_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F009DynamicLlmRoutingEngine {
  private readonly config: F009DynamicLlmRoutingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F009DynamicLlmRoutingOutput[] = [];
  private readonly auditLog: F009DynamicLlmRoutingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F009DynamicLlmRoutingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F009DynamicLlmRoutingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F009_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F009DynamicLlmRoutingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F009DynamicLlmRoutingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F009DynamicLlmRoutingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.route_id).trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("route_id", "Primary domain attribute 'route_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      route_id: input.route_id,
      selected_model: input.selected_model,
      complexity_tier: input.complexity_tier,
      estimated_cost_usd: input.estimated_cost_usd
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F009DynamicLlmRoutingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F009DynamicLlmRoutingInput): F009DynamicLlmRoutingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F009_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        route_id: input.route_id,
        selected_model: input.selected_model,
        complexity_tier: input.complexity_tier,
        estimated_cost_usd: input.estimated_cost_usd
      });
      const payloadHash = computeF009Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F009DynamicLlmRoutingValidationError(
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
        featureId: F009_FEATURE_ID,
        operationCode: F009_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          route_id: input.route_id,
          selected_model: input.selected_model,
          complexity_tier: input.complexity_tier,
          estimated_cost_usd: input.estimated_cost_usd
        }
      });

      const executionId = `exec_f009_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f009_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F009DynamicLlmRoutingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F009_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `llm_router:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F009DynamicLlmRoutingOutput = {
        featureId: F009_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F009_OPERATION_CODE,
        resolved_route_id: kernelResult.resolvedFields.route_id as string,
        resolved_selected_model: kernelResult.resolvedFields.selected_model as string | number,
        resolved_complexity_tier: kernelResult.resolvedFields.complexity_tier as string | number | boolean | readonly string[],
        resolved_estimated_cost_usd: kernelResult.resolvedFields.estimated_cost_usd as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F009DynamicLlmRoutingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F009_FEATURE_ID,
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

  public getAuditTrail(): readonly F009DynamicLlmRoutingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F009DynamicLlmRoutingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF009Module(): {
  featureId: typeof F009_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F009DynamicLlmRoutingEngine();
  const sampleInput: F009DynamicLlmRoutingInput = {
    requestId: "req_verify_f009",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    route_id: "f009_route_id_seed",
    selected_model: 42,
    complexity_tier: true,
    estimated_cost_usd: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 9 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F009" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_route_id !== sampleInput.route_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F009_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
