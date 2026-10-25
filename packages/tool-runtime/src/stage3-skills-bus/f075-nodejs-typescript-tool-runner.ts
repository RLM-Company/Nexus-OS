/**
 * F075 (stage3-skills-bus): Исполнение Node.js / TypeScript-инструментов
 * Выполнение серверных скриптов, парсеров и проверка сборки прямо из рабочей сессии
 * Operation Code: node_ts_executor
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F075_FEATURE_ID = "F075" as const;
export const F075_STAGE = "stage3-skills-bus" as const;
export const F075_OPERATION_CODE = "node_ts_executor" as const;
export const F075_CONTRACT_VERSION = "2.0.0" as const;

export type F075NodejsTypescriptToolRunnerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F075NodejsTypescriptToolRunnerConfig {
  readonly featureId: typeof F075_FEATURE_ID;
  readonly stage: typeof F075_STAGE;
  readonly operationCode: typeof F075_OPERATION_CODE;
  readonly contractVersion: typeof F075_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F075NodejsTypescriptToolRunnerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly execution_id: string;
  readonly ts_module_name: string | number;
  readonly typecheck_passed: string | number | boolean | readonly string[];
  readonly execution_output: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F075NodejsTypescriptToolRunnerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F075_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F075NodejsTypescriptToolRunnerOutput {
  readonly featureId: typeof F075_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F075NodejsTypescriptToolRunnerExecutionStatus;
  readonly operationCode: typeof F075_OPERATION_CODE;
  readonly resolved_execution_id: string;
  readonly resolved_ts_module_name: string | number;
  readonly resolved_typecheck_passed: string | number | boolean | readonly string[];
  readonly resolved_execution_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F075NodejsTypescriptToolRunnerAuditEntry;
}

export interface F075NodejsTypescriptToolRunnerTelemetrySnapshot {
  readonly featureId: typeof F075_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F075_CONFIG: F075NodejsTypescriptToolRunnerConfig = {
  featureId: F075_FEATURE_ID,
  stage: F075_STAGE,
  operationCode: F075_OPERATION_CODE,
  contractVersion: F075_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F075NodejsTypescriptToolRunnerValidationError extends Error {
  public readonly featureId = F075_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F075 Validation Error on '${field}']: ${message}`);
    this.name = "F075NodejsTypescriptToolRunnerValidationError";
    this.field = field;
  }
}

export function computeF075Digest(rawPayload: string): string {
  return `f075_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F075NodejsTypescriptToolRunnerEngine {
  private readonly config: F075NodejsTypescriptToolRunnerConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F075NodejsTypescriptToolRunnerOutput[] = [];
  private readonly auditLog: F075NodejsTypescriptToolRunnerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F075NodejsTypescriptToolRunnerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F075NodejsTypescriptToolRunnerConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F075_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F075NodejsTypescriptToolRunnerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F075NodejsTypescriptToolRunnerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F075NodejsTypescriptToolRunnerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.execution_id).trim().length === 0) {
      throw new F075NodejsTypescriptToolRunnerValidationError("execution_id", "Primary domain attribute 'execution_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      execution_id: input.execution_id,
      ts_module_name: input.ts_module_name,
      typecheck_passed: input.typecheck_passed,
      execution_output: input.execution_output
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F075NodejsTypescriptToolRunnerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F075NodejsTypescriptToolRunnerInput): F075NodejsTypescriptToolRunnerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F075_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        execution_id: input.execution_id,
        ts_module_name: input.ts_module_name,
        typecheck_passed: input.typecheck_passed,
        execution_output: input.execution_output
      });
      const payloadHash = computeF075Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F075NodejsTypescriptToolRunnerValidationError(
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
        featureId: F075_FEATURE_ID,
        operationCode: F075_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          execution_id: input.execution_id,
          ts_module_name: input.ts_module_name,
          typecheck_passed: input.typecheck_passed,
          execution_output: input.execution_output
        }
      });

      const executionId = `exec_f075_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f075_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F075NodejsTypescriptToolRunnerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F075_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `node_ts_executor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F075NodejsTypescriptToolRunnerOutput = {
        featureId: F075_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F075_OPERATION_CODE,
        resolved_execution_id: kernelResult.resolvedFields.execution_id as string,
        resolved_ts_module_name: kernelResult.resolvedFields.ts_module_name as string | number,
        resolved_typecheck_passed: kernelResult.resolvedFields.typecheck_passed as string | number | boolean | readonly string[],
        resolved_execution_output: kernelResult.resolvedFields.execution_output as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F075NodejsTypescriptToolRunnerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F075_FEATURE_ID,
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

  public getAuditTrail(): readonly F075NodejsTypescriptToolRunnerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F075NodejsTypescriptToolRunnerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF075Module(): {
  featureId: typeof F075_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F075NodejsTypescriptToolRunnerEngine();
  const sampleInput: F075NodejsTypescriptToolRunnerInput = {
    requestId: "req_verify_f075",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    execution_id: "f075_execution_id_seed",
    ts_module_name: 42,
    typecheck_passed: true,
    execution_output: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 75 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F075" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_execution_id !== sampleInput.execution_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F075_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
