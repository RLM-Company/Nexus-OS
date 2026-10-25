/**
 * F074 (stage3-skills-bus): Исполнение Python-скриптов в контролируемой среде
 * Запуск расчётов, pandas-аналитики и построения графиков в изолированном рантайме
 * Operation Code: python_sandbox_executor
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F074_FEATURE_ID = "F074" as const;
export const F074_STAGE = "stage3-skills-bus" as const;
export const F074_OPERATION_CODE = "python_sandbox_executor" as const;
export const F074_CONTRACT_VERSION = "2.0.0" as const;

export type F074ControlledPythonRuntimeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F074ControlledPythonRuntimeConfig {
  readonly featureId: typeof F074_FEATURE_ID;
  readonly stage: typeof F074_STAGE;
  readonly operationCode: typeof F074_OPERATION_CODE;
  readonly contractVersion: typeof F074_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F074ControlledPythonRuntimeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly execution_id: string;
  readonly script_hash: string | number;
  readonly exit_code: string | number | boolean | readonly string[];
  readonly captured_stdout: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F074ControlledPythonRuntimeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F074_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F074ControlledPythonRuntimeOutput {
  readonly featureId: typeof F074_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F074ControlledPythonRuntimeExecutionStatus;
  readonly operationCode: typeof F074_OPERATION_CODE;
  readonly resolved_execution_id: string;
  readonly resolved_script_hash: string | number;
  readonly resolved_exit_code: string | number | boolean | readonly string[];
  readonly resolved_captured_stdout: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F074ControlledPythonRuntimeAuditEntry;
}

export interface F074ControlledPythonRuntimeTelemetrySnapshot {
  readonly featureId: typeof F074_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F074_CONFIG: F074ControlledPythonRuntimeConfig = {
  featureId: F074_FEATURE_ID,
  stage: F074_STAGE,
  operationCode: F074_OPERATION_CODE,
  contractVersion: F074_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F074ControlledPythonRuntimeValidationError extends Error {
  public readonly featureId = F074_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F074 Validation Error on '${field}']: ${message}`);
    this.name = "F074ControlledPythonRuntimeValidationError";
    this.field = field;
  }
}

export function computeF074Digest(rawPayload: string): string {
  return `f074_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F074ControlledPythonRuntimeEngine {
  private readonly config: F074ControlledPythonRuntimeConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F074ControlledPythonRuntimeOutput[] = [];
  private readonly auditLog: F074ControlledPythonRuntimeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F074ControlledPythonRuntimeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F074ControlledPythonRuntimeConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F074_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F074ControlledPythonRuntimeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F074ControlledPythonRuntimeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F074ControlledPythonRuntimeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.execution_id).trim().length === 0) {
      throw new F074ControlledPythonRuntimeValidationError("execution_id", "Primary domain attribute 'execution_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      execution_id: input.execution_id,
      script_hash: input.script_hash,
      exit_code: input.exit_code,
      captured_stdout: input.captured_stdout
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F074ControlledPythonRuntimeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F074ControlledPythonRuntimeInput): F074ControlledPythonRuntimeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F074_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        execution_id: input.execution_id,
        script_hash: input.script_hash,
        exit_code: input.exit_code,
        captured_stdout: input.captured_stdout
      });
      const payloadHash = computeF074Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F074ControlledPythonRuntimeValidationError(
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
        featureId: F074_FEATURE_ID,
        operationCode: F074_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          execution_id: input.execution_id,
          script_hash: input.script_hash,
          exit_code: input.exit_code,
          captured_stdout: input.captured_stdout
        }
      });

      const executionId = `exec_f074_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f074_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F074ControlledPythonRuntimeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F074_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `python_sandbox_executor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F074ControlledPythonRuntimeOutput = {
        featureId: F074_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F074_OPERATION_CODE,
        resolved_execution_id: kernelResult.resolvedFields.execution_id as string,
        resolved_script_hash: kernelResult.resolvedFields.script_hash as string | number,
        resolved_exit_code: kernelResult.resolvedFields.exit_code as string | number | boolean | readonly string[],
        resolved_captured_stdout: kernelResult.resolvedFields.captured_stdout as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F074ControlledPythonRuntimeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F074_FEATURE_ID,
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

  public getAuditTrail(): readonly F074ControlledPythonRuntimeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F074ControlledPythonRuntimeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF074Module(): {
  featureId: typeof F074_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F074ControlledPythonRuntimeEngine();
  const sampleInput: F074ControlledPythonRuntimeInput = {
    requestId: "req_verify_f074",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    execution_id: "f074_execution_id_seed",
    script_hash: 42,
    exit_code: true,
    captured_stdout: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 74 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F074" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_execution_id !== sampleInput.execution_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F074_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
