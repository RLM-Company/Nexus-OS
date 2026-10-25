/**
 * F081 (stage3-skills-bus): Анализатор кодовой базы (AST Codebase Navigation)
 * Поиск определений функций, классов и зависимостей по дереву синтаксиса репозитория
 * Operation Code: ast_symbol_indexer
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F081_FEATURE_ID = "F081" as const;
export const F081_STAGE = "stage3-skills-bus" as const;
export const F081_OPERATION_CODE = "ast_symbol_indexer" as const;
export const F081_CONTRACT_VERSION = "2.0.0" as const;

export type F081AstCodebaseNavigatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F081AstCodebaseNavigatorConfig {
  readonly featureId: typeof F081_FEATURE_ID;
  readonly stage: typeof F081_STAGE;
  readonly operationCode: typeof F081_OPERATION_CODE;
  readonly contractVersion: typeof F081_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F081AstCodebaseNavigatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly file_path: string;
  readonly exported_symbols: string | number;
  readonly import_dependencies: string | number | boolean | readonly string[];
  readonly ast_depth: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F081AstCodebaseNavigatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F081_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F081AstCodebaseNavigatorOutput {
  readonly featureId: typeof F081_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F081AstCodebaseNavigatorExecutionStatus;
  readonly operationCode: typeof F081_OPERATION_CODE;
  readonly resolved_file_path: string;
  readonly resolved_exported_symbols: string | number;
  readonly resolved_import_dependencies: string | number | boolean | readonly string[];
  readonly resolved_ast_depth: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F081AstCodebaseNavigatorAuditEntry;
}

export interface F081AstCodebaseNavigatorTelemetrySnapshot {
  readonly featureId: typeof F081_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F081_CONFIG: F081AstCodebaseNavigatorConfig = {
  featureId: F081_FEATURE_ID,
  stage: F081_STAGE,
  operationCode: F081_OPERATION_CODE,
  contractVersion: F081_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F081AstCodebaseNavigatorValidationError extends Error {
  public readonly featureId = F081_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F081 Validation Error on '${field}']: ${message}`);
    this.name = "F081AstCodebaseNavigatorValidationError";
    this.field = field;
  }
}

export function computeF081Digest(rawPayload: string): string {
  return `f081_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F081AstCodebaseNavigatorEngine {
  private readonly config: F081AstCodebaseNavigatorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F081AstCodebaseNavigatorOutput[] = [];
  private readonly auditLog: F081AstCodebaseNavigatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F081AstCodebaseNavigatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F081AstCodebaseNavigatorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F081_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F081AstCodebaseNavigatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F081AstCodebaseNavigatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F081AstCodebaseNavigatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.file_path).trim().length === 0) {
      throw new F081AstCodebaseNavigatorValidationError("file_path", "Primary domain attribute 'file_path' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      file_path: input.file_path,
      exported_symbols: input.exported_symbols,
      import_dependencies: input.import_dependencies,
      ast_depth: input.ast_depth
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F081AstCodebaseNavigatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F081AstCodebaseNavigatorInput): F081AstCodebaseNavigatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F081_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        file_path: input.file_path,
        exported_symbols: input.exported_symbols,
        import_dependencies: input.import_dependencies,
        ast_depth: input.ast_depth
      });
      const payloadHash = computeF081Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F081AstCodebaseNavigatorValidationError(
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
        featureId: F081_FEATURE_ID,
        operationCode: F081_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          file_path: input.file_path,
          exported_symbols: input.exported_symbols,
          import_dependencies: input.import_dependencies,
          ast_depth: input.ast_depth
        }
      });

      const executionId = `exec_f081_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f081_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F081AstCodebaseNavigatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F081_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ast_symbol_indexer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F081AstCodebaseNavigatorOutput = {
        featureId: F081_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F081_OPERATION_CODE,
        resolved_file_path: kernelResult.resolvedFields.file_path as string,
        resolved_exported_symbols: kernelResult.resolvedFields.exported_symbols as string | number,
        resolved_import_dependencies: kernelResult.resolvedFields.import_dependencies as string | number | boolean | readonly string[],
        resolved_ast_depth: kernelResult.resolvedFields.ast_depth as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F081AstCodebaseNavigatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F081_FEATURE_ID,
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

  public getAuditTrail(): readonly F081AstCodebaseNavigatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F081AstCodebaseNavigatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF081Module(): {
  featureId: typeof F081_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F081AstCodebaseNavigatorEngine();
  const sampleInput: F081AstCodebaseNavigatorInput = {
    requestId: "req_verify_f081",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    file_path: "f081_file_path_seed",
    exported_symbols: 42,
    import_dependencies: true,
    ast_depth: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 81 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F081" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_file_path !== sampleInput.file_path &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F081_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
