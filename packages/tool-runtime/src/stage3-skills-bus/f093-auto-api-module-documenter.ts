/**
 * F093 (stage3-skills-bus): Авто-документирование API и модулей
 * Генерация актуальных README и JSDoc/Docstring по изменённым файлам
 * Operation Code: autodoc_generator
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F093_FEATURE_ID = "F093" as const;
export const F093_STAGE = "stage3-skills-bus" as const;
export const F093_OPERATION_CODE = "autodoc_generator" as const;
export const F093_CONTRACT_VERSION = "2.0.0" as const;

export type F093AutoApiModuleDocumenterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F093AutoApiModuleDocumenterConfig {
  readonly featureId: typeof F093_FEATURE_ID;
  readonly stage: typeof F093_STAGE;
  readonly operationCode: typeof F093_OPERATION_CODE;
  readonly contractVersion: typeof F093_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F093AutoApiModuleDocumenterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly module_path: string;
  readonly documented_exports: string | number;
  readonly generated_jsdoc: string | number | boolean | readonly string[];
  readonly readme_section: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F093AutoApiModuleDocumenterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F093_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F093AutoApiModuleDocumenterOutput {
  readonly featureId: typeof F093_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F093AutoApiModuleDocumenterExecutionStatus;
  readonly operationCode: typeof F093_OPERATION_CODE;
  readonly resolved_module_path: string;
  readonly resolved_documented_exports: string | number;
  readonly resolved_generated_jsdoc: string | number | boolean | readonly string[];
  readonly resolved_readme_section: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F093AutoApiModuleDocumenterAuditEntry;
}

export interface F093AutoApiModuleDocumenterTelemetrySnapshot {
  readonly featureId: typeof F093_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F093_CONFIG: F093AutoApiModuleDocumenterConfig = {
  featureId: F093_FEATURE_ID,
  stage: F093_STAGE,
  operationCode: F093_OPERATION_CODE,
  contractVersion: F093_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F093AutoApiModuleDocumenterValidationError extends Error {
  public readonly featureId = F093_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F093 Validation Error on '${field}']: ${message}`);
    this.name = "F093AutoApiModuleDocumenterValidationError";
    this.field = field;
  }
}

export function computeF093Digest(rawPayload: string): string {
  return `f093_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F093AutoApiModuleDocumenterEngine {
  private readonly config: F093AutoApiModuleDocumenterConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F093AutoApiModuleDocumenterOutput[] = [];
  private readonly auditLog: F093AutoApiModuleDocumenterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F093AutoApiModuleDocumenterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F093AutoApiModuleDocumenterConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F093_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F093AutoApiModuleDocumenterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F093AutoApiModuleDocumenterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F093AutoApiModuleDocumenterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.module_path).trim().length === 0) {
      throw new F093AutoApiModuleDocumenterValidationError("module_path", "Primary domain attribute 'module_path' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      module_path: input.module_path,
      documented_exports: input.documented_exports,
      generated_jsdoc: input.generated_jsdoc,
      readme_section: input.readme_section
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F093AutoApiModuleDocumenterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F093AutoApiModuleDocumenterInput): F093AutoApiModuleDocumenterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F093_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        module_path: input.module_path,
        documented_exports: input.documented_exports,
        generated_jsdoc: input.generated_jsdoc,
        readme_section: input.readme_section
      });
      const payloadHash = computeF093Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F093AutoApiModuleDocumenterValidationError(
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
        featureId: F093_FEATURE_ID,
        operationCode: F093_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          module_path: input.module_path,
          documented_exports: input.documented_exports,
          generated_jsdoc: input.generated_jsdoc,
          readme_section: input.readme_section
        }
      });

      const executionId = `exec_f093_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f093_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F093AutoApiModuleDocumenterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F093_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `autodoc_generator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F093AutoApiModuleDocumenterOutput = {
        featureId: F093_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F093_OPERATION_CODE,
        resolved_module_path: kernelResult.resolvedFields.module_path as string,
        resolved_documented_exports: kernelResult.resolvedFields.documented_exports as string | number,
        resolved_generated_jsdoc: kernelResult.resolvedFields.generated_jsdoc as string | number | boolean | readonly string[],
        resolved_readme_section: kernelResult.resolvedFields.readme_section as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F093AutoApiModuleDocumenterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F093_FEATURE_ID,
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

  public getAuditTrail(): readonly F093AutoApiModuleDocumenterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F093AutoApiModuleDocumenterOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF093Module(): {
  featureId: typeof F093_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F093AutoApiModuleDocumenterEngine();
  const sampleInput: F093AutoApiModuleDocumenterInput = {
    requestId: "req_verify_f093",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    module_path: "f093_module_path_seed",
    documented_exports: 42,
    generated_jsdoc: true,
    readme_section: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 93 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F093" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_module_path !== sampleInput.module_path &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F093_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
