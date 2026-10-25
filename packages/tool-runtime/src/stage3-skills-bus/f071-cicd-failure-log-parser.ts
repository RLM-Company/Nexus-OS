/**
 * F071 (stage3-skills-bus): Автоматический парсинг логов упавших CI/CD пайплайнов
 * Чтение ошибок GitHub Actions и генерация патча для починки сборки
 * Operation Code: ci_log_diagnostics
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F071_FEATURE_ID = "F071" as const;
export const F071_STAGE = "stage3-skills-bus" as const;
export const F071_OPERATION_CODE = "ci_log_diagnostics" as const;
export const F071_CONTRACT_VERSION = "2.0.0" as const;

export type F071CicdFailureLogParserExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F071CicdFailureLogParserConfig {
  readonly featureId: typeof F071_FEATURE_ID;
  readonly stage: typeof F071_STAGE;
  readonly operationCode: typeof F071_OPERATION_CODE;
  readonly contractVersion: typeof F071_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F071CicdFailureLogParserInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workflow_run_id: string;
  readonly error_code: string | number;
  readonly failing_file: string | number | boolean | readonly string[];
  readonly auto_patch_diff: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F071CicdFailureLogParserAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F071_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F071CicdFailureLogParserOutput {
  readonly featureId: typeof F071_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F071CicdFailureLogParserExecutionStatus;
  readonly operationCode: typeof F071_OPERATION_CODE;
  readonly resolved_workflow_run_id: string;
  readonly resolved_error_code: string | number;
  readonly resolved_failing_file: string | number | boolean | readonly string[];
  readonly resolved_auto_patch_diff: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F071CicdFailureLogParserAuditEntry;
}

export interface F071CicdFailureLogParserTelemetrySnapshot {
  readonly featureId: typeof F071_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F071_CONFIG: F071CicdFailureLogParserConfig = {
  featureId: F071_FEATURE_ID,
  stage: F071_STAGE,
  operationCode: F071_OPERATION_CODE,
  contractVersion: F071_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F071CicdFailureLogParserValidationError extends Error {
  public readonly featureId = F071_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F071 Validation Error on '${field}']: ${message}`);
    this.name = "F071CicdFailureLogParserValidationError";
    this.field = field;
  }
}

export function computeF071Digest(rawPayload: string): string {
  return `f071_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F071CicdFailureLogParserEngine {
  private readonly config: F071CicdFailureLogParserConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F071CicdFailureLogParserOutput[] = [];
  private readonly auditLog: F071CicdFailureLogParserAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F071CicdFailureLogParserOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F071CicdFailureLogParserConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F071_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F071CicdFailureLogParserConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F071CicdFailureLogParserInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F071CicdFailureLogParserValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workflow_run_id).trim().length === 0) {
      throw new F071CicdFailureLogParserValidationError("workflow_run_id", "Primary domain attribute 'workflow_run_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workflow_run_id: input.workflow_run_id,
      error_code: input.error_code,
      failing_file: input.failing_file,
      auto_patch_diff: input.auto_patch_diff
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F071CicdFailureLogParserValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F071CicdFailureLogParserInput): F071CicdFailureLogParserOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F071_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workflow_run_id: input.workflow_run_id,
        error_code: input.error_code,
        failing_file: input.failing_file,
        auto_patch_diff: input.auto_patch_diff
      });
      const payloadHash = computeF071Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F071CicdFailureLogParserValidationError(
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
        featureId: F071_FEATURE_ID,
        operationCode: F071_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workflow_run_id: input.workflow_run_id,
          error_code: input.error_code,
          failing_file: input.failing_file,
          auto_patch_diff: input.auto_patch_diff
        }
      });

      const executionId = `exec_f071_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f071_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F071CicdFailureLogParserAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F071_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ci_log_diagnostics:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F071CicdFailureLogParserOutput = {
        featureId: F071_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F071_OPERATION_CODE,
        resolved_workflow_run_id: kernelResult.resolvedFields.workflow_run_id as string,
        resolved_error_code: kernelResult.resolvedFields.error_code as string | number,
        resolved_failing_file: kernelResult.resolvedFields.failing_file as string | number | boolean | readonly string[],
        resolved_auto_patch_diff: kernelResult.resolvedFields.auto_patch_diff as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F071CicdFailureLogParserTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F071_FEATURE_ID,
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

  public getAuditTrail(): readonly F071CicdFailureLogParserAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F071CicdFailureLogParserOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF071Module(): {
  featureId: typeof F071_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F071CicdFailureLogParserEngine();
  const sampleInput: F071CicdFailureLogParserInput = {
    requestId: "req_verify_f071",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workflow_run_id: "f071_workflow_run_id_seed",
    error_code: 42,
    failing_file: true,
    auto_patch_diff: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 71 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F071" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workflow_run_id !== sampleInput.workflow_run_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F071_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
