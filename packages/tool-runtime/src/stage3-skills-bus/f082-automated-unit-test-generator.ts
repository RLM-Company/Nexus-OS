/**
 * F082 (stage3-skills-bus): Автоматический генератор юнит-тестов
 * Написание и прогон тестов под новый функционал до отправки в ветку
 * Operation Code: unit_test_synthesizer
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F082_FEATURE_ID = "F082" as const;
export const F082_STAGE = "stage3-skills-bus" as const;
export const F082_OPERATION_CODE = "unit_test_synthesizer" as const;
export const F082_CONTRACT_VERSION = "2.0.0" as const;

export type F082AutomatedUnitTestGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F082AutomatedUnitTestGeneratorConfig {
  readonly featureId: typeof F082_FEATURE_ID;
  readonly stage: typeof F082_STAGE;
  readonly operationCode: typeof F082_OPERATION_CODE;
  readonly contractVersion: typeof F082_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F082AutomatedUnitTestGeneratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly target_module: string;
  readonly generated_assertions_count: string | number;
  readonly suite_code: string | number | boolean | readonly string[];
  readonly all_green: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F082AutomatedUnitTestGeneratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F082_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F082AutomatedUnitTestGeneratorOutput {
  readonly featureId: typeof F082_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F082AutomatedUnitTestGeneratorExecutionStatus;
  readonly operationCode: typeof F082_OPERATION_CODE;
  readonly resolved_target_module: string;
  readonly resolved_generated_assertions_count: string | number;
  readonly resolved_suite_code: string | number | boolean | readonly string[];
  readonly resolved_all_green: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F082AutomatedUnitTestGeneratorAuditEntry;
}

export interface F082AutomatedUnitTestGeneratorTelemetrySnapshot {
  readonly featureId: typeof F082_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F082_CONFIG: F082AutomatedUnitTestGeneratorConfig = {
  featureId: F082_FEATURE_ID,
  stage: F082_STAGE,
  operationCode: F082_OPERATION_CODE,
  contractVersion: F082_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F082AutomatedUnitTestGeneratorValidationError extends Error {
  public readonly featureId = F082_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F082 Validation Error on '${field}']: ${message}`);
    this.name = "F082AutomatedUnitTestGeneratorValidationError";
    this.field = field;
  }
}

export function computeF082Digest(rawPayload: string): string {
  return `f082_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F082AutomatedUnitTestGeneratorEngine {
  private readonly config: F082AutomatedUnitTestGeneratorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F082AutomatedUnitTestGeneratorOutput[] = [];
  private readonly auditLog: F082AutomatedUnitTestGeneratorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F082AutomatedUnitTestGeneratorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F082AutomatedUnitTestGeneratorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F082_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F082AutomatedUnitTestGeneratorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F082AutomatedUnitTestGeneratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F082AutomatedUnitTestGeneratorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.target_module).trim().length === 0) {
      throw new F082AutomatedUnitTestGeneratorValidationError("target_module", "Primary domain attribute 'target_module' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      target_module: input.target_module,
      generated_assertions_count: input.generated_assertions_count,
      suite_code: input.suite_code,
      all_green: input.all_green
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F082AutomatedUnitTestGeneratorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F082AutomatedUnitTestGeneratorInput): F082AutomatedUnitTestGeneratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F082_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        target_module: input.target_module,
        generated_assertions_count: input.generated_assertions_count,
        suite_code: input.suite_code,
        all_green: input.all_green
      });
      const payloadHash = computeF082Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F082AutomatedUnitTestGeneratorValidationError(
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
        featureId: F082_FEATURE_ID,
        operationCode: F082_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          target_module: input.target_module,
          generated_assertions_count: input.generated_assertions_count,
          suite_code: input.suite_code,
          all_green: input.all_green
        }
      });

      const executionId = `exec_f082_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f082_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F082AutomatedUnitTestGeneratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F082_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `unit_test_synthesizer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F082AutomatedUnitTestGeneratorOutput = {
        featureId: F082_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F082_OPERATION_CODE,
        resolved_target_module: kernelResult.resolvedFields.target_module as string,
        resolved_generated_assertions_count: kernelResult.resolvedFields.generated_assertions_count as string | number,
        resolved_suite_code: kernelResult.resolvedFields.suite_code as string | number | boolean | readonly string[],
        resolved_all_green: kernelResult.resolvedFields.all_green as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F082AutomatedUnitTestGeneratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F082_FEATURE_ID,
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

  public getAuditTrail(): readonly F082AutomatedUnitTestGeneratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F082AutomatedUnitTestGeneratorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF082Module(): {
  featureId: typeof F082_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F082AutomatedUnitTestGeneratorEngine();
  const sampleInput: F082AutomatedUnitTestGeneratorInput = {
    requestId: "req_verify_f082",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    target_module: "f082_target_module_seed",
    generated_assertions_count: 42,
    suite_code: true,
    all_green: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 82 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F082" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_target_module !== sampleInput.target_module &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F082_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
