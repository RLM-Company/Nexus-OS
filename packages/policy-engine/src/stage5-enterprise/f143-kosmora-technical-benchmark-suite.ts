/**
 * F143 (stage5-enterprise): Сьют технических бенчмарков для Kosmora (Benchmark Suite)
 * Автоматизированный прогон эталонных задач для замера точности, скорости и стоимости после коммита
 * Operation Code: benchmark_harness
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F143_FEATURE_ID = "F143" as const;
export const F143_STAGE = "stage5-enterprise" as const;
export const F143_OPERATION_CODE = "benchmark_harness" as const;
export const F143_CONTRACT_VERSION = "2.0.0" as const;

export type F143KosmoraTechnicalBenchmarkSuiteExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F143KosmoraTechnicalBenchmarkSuiteConfig {
  readonly featureId: typeof F143_FEATURE_ID;
  readonly stage: typeof F143_STAGE;
  readonly operationCode: typeof F143_OPERATION_CODE;
  readonly contractVersion: typeof F143_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F143KosmoraTechnicalBenchmarkSuiteInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly suite_version: string;
  readonly scenarios_executed: string | number;
  readonly accuracy_score_pct: string | number | boolean | readonly string[];
  readonly cost_per_run_usd: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F143KosmoraTechnicalBenchmarkSuiteAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F143_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F143KosmoraTechnicalBenchmarkSuiteOutput {
  readonly featureId: typeof F143_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F143KosmoraTechnicalBenchmarkSuiteExecutionStatus;
  readonly operationCode: typeof F143_OPERATION_CODE;
  readonly resolved_suite_version: string;
  readonly resolved_scenarios_executed: string | number;
  readonly resolved_accuracy_score_pct: string | number | boolean | readonly string[];
  readonly resolved_cost_per_run_usd: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F143KosmoraTechnicalBenchmarkSuiteAuditEntry;
}

export interface F143KosmoraTechnicalBenchmarkSuiteTelemetrySnapshot {
  readonly featureId: typeof F143_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F143_CONFIG: F143KosmoraTechnicalBenchmarkSuiteConfig = {
  featureId: F143_FEATURE_ID,
  stage: F143_STAGE,
  operationCode: F143_OPERATION_CODE,
  contractVersion: F143_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F143KosmoraTechnicalBenchmarkSuiteValidationError extends Error {
  public readonly featureId = F143_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F143 Validation Error on '${field}']: ${message}`);
    this.name = "F143KosmoraTechnicalBenchmarkSuiteValidationError";
    this.field = field;
  }
}

export function computeF143Digest(rawPayload: string): string {
  return `f143_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F143KosmoraTechnicalBenchmarkSuiteEngine {
  private readonly config: F143KosmoraTechnicalBenchmarkSuiteConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F143KosmoraTechnicalBenchmarkSuiteOutput[] = [];
  private readonly auditLog: F143KosmoraTechnicalBenchmarkSuiteAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F143KosmoraTechnicalBenchmarkSuiteOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F143KosmoraTechnicalBenchmarkSuiteConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F143_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F143KosmoraTechnicalBenchmarkSuiteConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F143KosmoraTechnicalBenchmarkSuiteInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.suite_version).trim().length === 0) {
      throw new F143KosmoraTechnicalBenchmarkSuiteValidationError("suite_version", "Primary domain attribute 'suite_version' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      suite_version: input.suite_version,
      scenarios_executed: input.scenarios_executed,
      accuracy_score_pct: input.accuracy_score_pct,
      cost_per_run_usd: input.cost_per_run_usd
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F143KosmoraTechnicalBenchmarkSuiteValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F143KosmoraTechnicalBenchmarkSuiteInput): F143KosmoraTechnicalBenchmarkSuiteOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F143_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        suite_version: input.suite_version,
        scenarios_executed: input.scenarios_executed,
        accuracy_score_pct: input.accuracy_score_pct,
        cost_per_run_usd: input.cost_per_run_usd
      });
      const payloadHash = computeF143Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F143KosmoraTechnicalBenchmarkSuiteValidationError(
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
        featureId: F143_FEATURE_ID,
        operationCode: F143_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          suite_version: input.suite_version,
          scenarios_executed: input.scenarios_executed,
          accuracy_score_pct: input.accuracy_score_pct,
          cost_per_run_usd: input.cost_per_run_usd
        }
      });

      const executionId = `exec_f143_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f143_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F143KosmoraTechnicalBenchmarkSuiteAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F143_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `benchmark_harness:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F143KosmoraTechnicalBenchmarkSuiteOutput = {
        featureId: F143_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F143_OPERATION_CODE,
        resolved_suite_version: kernelResult.resolvedFields.suite_version as string,
        resolved_scenarios_executed: kernelResult.resolvedFields.scenarios_executed as string | number,
        resolved_accuracy_score_pct: kernelResult.resolvedFields.accuracy_score_pct as string | number | boolean | readonly string[],
        resolved_cost_per_run_usd: kernelResult.resolvedFields.cost_per_run_usd as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F143KosmoraTechnicalBenchmarkSuiteTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F143_FEATURE_ID,
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

  public getAuditTrail(): readonly F143KosmoraTechnicalBenchmarkSuiteAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F143KosmoraTechnicalBenchmarkSuiteOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF143Module(): {
  featureId: typeof F143_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F143KosmoraTechnicalBenchmarkSuiteEngine();
  const sampleInput: F143KosmoraTechnicalBenchmarkSuiteInput = {
    requestId: "req_verify_f143",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    suite_version: "f143_suite_version_seed",
    scenarios_executed: 42,
    accuracy_score_pct: true,
    cost_per_run_usd: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 143 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F143" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_suite_version !== sampleInput.suite_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F143_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
