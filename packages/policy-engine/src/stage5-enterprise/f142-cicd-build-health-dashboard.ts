/**
 * F142 (stage5-enterprise): Панель здоровья CI/CD и авто-диагностика билдов
 * Мониторинг сборок монорепозитория с быстрым выявлением падающих тестов типизации и интеграций
 * Operation Code: monorepo_health_probe
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F142_FEATURE_ID = "F142" as const;
export const F142_STAGE = "stage5-enterprise" as const;
export const F142_OPERATION_CODE = "monorepo_health_probe" as const;
export const F142_CONTRACT_VERSION = "2.0.0" as const;

export type F142CicdBuildHealthDashboardExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F142CicdBuildHealthDashboardConfig {
  readonly featureId: typeof F142_FEATURE_ID;
  readonly stage: typeof F142_STAGE;
  readonly operationCode: typeof F142_OPERATION_CODE;
  readonly contractVersion: typeof F142_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F142CicdBuildHealthDashboardInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly pipeline_id: string;
  readonly packages_checked: string | number;
  readonly typecheck_green: string | number | boolean | readonly string[];
  readonly test_suite_green: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F142CicdBuildHealthDashboardAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F142_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F142CicdBuildHealthDashboardOutput {
  readonly featureId: typeof F142_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F142CicdBuildHealthDashboardExecutionStatus;
  readonly operationCode: typeof F142_OPERATION_CODE;
  readonly resolved_pipeline_id: string;
  readonly resolved_packages_checked: string | number;
  readonly resolved_typecheck_green: string | number | boolean | readonly string[];
  readonly resolved_test_suite_green: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F142CicdBuildHealthDashboardAuditEntry;
}

export interface F142CicdBuildHealthDashboardTelemetrySnapshot {
  readonly featureId: typeof F142_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F142_CONFIG: F142CicdBuildHealthDashboardConfig = {
  featureId: F142_FEATURE_ID,
  stage: F142_STAGE,
  operationCode: F142_OPERATION_CODE,
  contractVersion: F142_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F142CicdBuildHealthDashboardValidationError extends Error {
  public readonly featureId = F142_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F142 Validation Error on '${field}']: ${message}`);
    this.name = "F142CicdBuildHealthDashboardValidationError";
    this.field = field;
  }
}

export function computeF142Digest(rawPayload: string): string {
  return `f142_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F142CicdBuildHealthDashboardEngine {
  private readonly config: F142CicdBuildHealthDashboardConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F142CicdBuildHealthDashboardOutput[] = [];
  private readonly auditLog: F142CicdBuildHealthDashboardAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F142CicdBuildHealthDashboardOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F142CicdBuildHealthDashboardConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F142_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F142CicdBuildHealthDashboardConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F142CicdBuildHealthDashboardInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F142CicdBuildHealthDashboardValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.pipeline_id).trim().length === 0) {
      throw new F142CicdBuildHealthDashboardValidationError("pipeline_id", "Primary domain attribute 'pipeline_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      pipeline_id: input.pipeline_id,
      packages_checked: input.packages_checked,
      typecheck_green: input.typecheck_green,
      test_suite_green: input.test_suite_green
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F142CicdBuildHealthDashboardValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F142CicdBuildHealthDashboardInput): F142CicdBuildHealthDashboardOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F142_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        pipeline_id: input.pipeline_id,
        packages_checked: input.packages_checked,
        typecheck_green: input.typecheck_green,
        test_suite_green: input.test_suite_green
      });
      const payloadHash = computeF142Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F142CicdBuildHealthDashboardValidationError(
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
        featureId: F142_FEATURE_ID,
        operationCode: F142_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          pipeline_id: input.pipeline_id,
          packages_checked: input.packages_checked,
          typecheck_green: input.typecheck_green,
          test_suite_green: input.test_suite_green
        }
      });

      const executionId = `exec_f142_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f142_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F142CicdBuildHealthDashboardAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F142_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `monorepo_health_probe:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F142CicdBuildHealthDashboardOutput = {
        featureId: F142_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F142_OPERATION_CODE,
        resolved_pipeline_id: kernelResult.resolvedFields.pipeline_id as string,
        resolved_packages_checked: kernelResult.resolvedFields.packages_checked as string | number,
        resolved_typecheck_green: kernelResult.resolvedFields.typecheck_green as string | number | boolean | readonly string[],
        resolved_test_suite_green: kernelResult.resolvedFields.test_suite_green as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F142CicdBuildHealthDashboardTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F142_FEATURE_ID,
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

  public getAuditTrail(): readonly F142CicdBuildHealthDashboardAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F142CicdBuildHealthDashboardOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF142Module(): {
  featureId: typeof F142_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F142CicdBuildHealthDashboardEngine();
  const sampleInput: F142CicdBuildHealthDashboardInput = {
    requestId: "req_verify_f142",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    pipeline_id: "f142_pipeline_id_seed",
    packages_checked: 42,
    typecheck_green: true,
    test_suite_green: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 142 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F142" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_pipeline_id !== sampleInput.pipeline_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F142_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
