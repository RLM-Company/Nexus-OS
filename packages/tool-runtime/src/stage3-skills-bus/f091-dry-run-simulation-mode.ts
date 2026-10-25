/**
 * F091 (stage3-skills-bus): Симулятор сухого прогона (Dry-Run Mode)
 * Показ того, какие файлы будут изменены или какие API вызваны, без фактической записи
 * Operation Code: dry_run_simulator
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F091_FEATURE_ID = "F091" as const;
export const F091_STAGE = "stage3-skills-bus" as const;
export const F091_OPERATION_CODE = "dry_run_simulator" as const;
export const F091_CONTRACT_VERSION = "2.0.0" as const;

export type F091DryRunSimulationModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F091DryRunSimulationModeConfig {
  readonly featureId: typeof F091_FEATURE_ID;
  readonly stage: typeof F091_STAGE;
  readonly operationCode: typeof F091_OPERATION_CODE;
  readonly contractVersion: typeof F091_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F091DryRunSimulationModeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly simulation_id: string;
  readonly planned_file_writes: string | number;
  readonly planned_api_calls: string | number | boolean | readonly string[];
  readonly zero_side_effects: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F091DryRunSimulationModeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F091_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F091DryRunSimulationModeOutput {
  readonly featureId: typeof F091_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F091DryRunSimulationModeExecutionStatus;
  readonly operationCode: typeof F091_OPERATION_CODE;
  readonly resolved_simulation_id: string;
  readonly resolved_planned_file_writes: string | number;
  readonly resolved_planned_api_calls: string | number | boolean | readonly string[];
  readonly resolved_zero_side_effects: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F091DryRunSimulationModeAuditEntry;
}

export interface F091DryRunSimulationModeTelemetrySnapshot {
  readonly featureId: typeof F091_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F091_CONFIG: F091DryRunSimulationModeConfig = {
  featureId: F091_FEATURE_ID,
  stage: F091_STAGE,
  operationCode: F091_OPERATION_CODE,
  contractVersion: F091_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F091DryRunSimulationModeValidationError extends Error {
  public readonly featureId = F091_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F091 Validation Error on '${field}']: ${message}`);
    this.name = "F091DryRunSimulationModeValidationError";
    this.field = field;
  }
}

export function computeF091Digest(rawPayload: string): string {
  return `f091_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F091DryRunSimulationModeEngine {
  private readonly config: F091DryRunSimulationModeConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F091DryRunSimulationModeOutput[] = [];
  private readonly auditLog: F091DryRunSimulationModeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F091DryRunSimulationModeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F091DryRunSimulationModeConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F091_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F091DryRunSimulationModeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F091DryRunSimulationModeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F091DryRunSimulationModeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.simulation_id).trim().length === 0) {
      throw new F091DryRunSimulationModeValidationError("simulation_id", "Primary domain attribute 'simulation_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      simulation_id: input.simulation_id,
      planned_file_writes: input.planned_file_writes,
      planned_api_calls: input.planned_api_calls,
      zero_side_effects: input.zero_side_effects
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F091DryRunSimulationModeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F091DryRunSimulationModeInput): F091DryRunSimulationModeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F091_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        simulation_id: input.simulation_id,
        planned_file_writes: input.planned_file_writes,
        planned_api_calls: input.planned_api_calls,
        zero_side_effects: input.zero_side_effects
      });
      const payloadHash = computeF091Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F091DryRunSimulationModeValidationError(
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
        featureId: F091_FEATURE_ID,
        operationCode: F091_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          simulation_id: input.simulation_id,
          planned_file_writes: input.planned_file_writes,
          planned_api_calls: input.planned_api_calls,
          zero_side_effects: input.zero_side_effects
        }
      });

      const executionId = `exec_f091_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f091_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F091DryRunSimulationModeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F091_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dry_run_simulator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F091DryRunSimulationModeOutput = {
        featureId: F091_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F091_OPERATION_CODE,
        resolved_simulation_id: kernelResult.resolvedFields.simulation_id as string,
        resolved_planned_file_writes: kernelResult.resolvedFields.planned_file_writes as string | number,
        resolved_planned_api_calls: kernelResult.resolvedFields.planned_api_calls as string | number | boolean | readonly string[],
        resolved_zero_side_effects: kernelResult.resolvedFields.zero_side_effects as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F091DryRunSimulationModeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F091_FEATURE_ID,
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

  public getAuditTrail(): readonly F091DryRunSimulationModeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F091DryRunSimulationModeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF091Module(): {
  featureId: typeof F091_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F091DryRunSimulationModeEngine();
  const sampleInput: F091DryRunSimulationModeInput = {
    requestId: "req_verify_f091",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    simulation_id: "f091_simulation_id_seed",
    planned_file_writes: 42,
    planned_api_calls: true,
    zero_side_effects: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 91 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F091" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_simulation_id !== sampleInput.simulation_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F091_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
