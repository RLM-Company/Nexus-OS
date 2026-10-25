/**
 * F127 (stage4-intelligence-graph): Быстрый глобальный поиск (Cmd/Ctrl + K)
 * Мгновенный переход к любому чату, узлу графа, скиллу или версии артефакта на Canvas
 * Operation Code: cmdk_omnibox_router
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F127_FEATURE_ID = "F127" as const;
export const F127_STAGE = "stage4-intelligence-graph" as const;
export const F127_OPERATION_CODE = "cmdk_omnibox_router" as const;
export const F127_CONTRACT_VERSION = "2.0.0" as const;

export type F127GlobalCmdkOmniSearchExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F127GlobalCmdkOmniSearchConfig {
  readonly featureId: typeof F127_FEATURE_ID;
  readonly stage: typeof F127_STAGE;
  readonly operationCode: typeof F127_OPERATION_CODE;
  readonly contractVersion: typeof F127_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F127GlobalCmdkOmniSearchInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly query_string: string;
  readonly matched_categories: string | number;
  readonly top_hit_id: string | number | boolean | readonly string[];
  readonly search_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F127GlobalCmdkOmniSearchAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F127_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F127GlobalCmdkOmniSearchOutput {
  readonly featureId: typeof F127_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F127GlobalCmdkOmniSearchExecutionStatus;
  readonly operationCode: typeof F127_OPERATION_CODE;
  readonly resolved_query_string: string;
  readonly resolved_matched_categories: string | number;
  readonly resolved_top_hit_id: string | number | boolean | readonly string[];
  readonly resolved_search_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F127GlobalCmdkOmniSearchAuditEntry;
}

export interface F127GlobalCmdkOmniSearchTelemetrySnapshot {
  readonly featureId: typeof F127_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F127_CONFIG: F127GlobalCmdkOmniSearchConfig = {
  featureId: F127_FEATURE_ID,
  stage: F127_STAGE,
  operationCode: F127_OPERATION_CODE,
  contractVersion: F127_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F127GlobalCmdkOmniSearchValidationError extends Error {
  public readonly featureId = F127_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F127 Validation Error on '${field}']: ${message}`);
    this.name = "F127GlobalCmdkOmniSearchValidationError";
    this.field = field;
  }
}

export function computeF127Digest(rawPayload: string): string {
  return `f127_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F127GlobalCmdkOmniSearchEngine {
  private readonly config: F127GlobalCmdkOmniSearchConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F127GlobalCmdkOmniSearchOutput[] = [];
  private readonly auditLog: F127GlobalCmdkOmniSearchAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F127GlobalCmdkOmniSearchOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F127GlobalCmdkOmniSearchConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F127_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F127GlobalCmdkOmniSearchConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F127GlobalCmdkOmniSearchInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F127GlobalCmdkOmniSearchValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.query_string).trim().length === 0) {
      throw new F127GlobalCmdkOmniSearchValidationError("query_string", "Primary domain attribute 'query_string' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      query_string: input.query_string,
      matched_categories: input.matched_categories,
      top_hit_id: input.top_hit_id,
      search_latency_ms: input.search_latency_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F127GlobalCmdkOmniSearchValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F127GlobalCmdkOmniSearchInput): F127GlobalCmdkOmniSearchOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F127_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        query_string: input.query_string,
        matched_categories: input.matched_categories,
        top_hit_id: input.top_hit_id,
        search_latency_ms: input.search_latency_ms
      });
      const payloadHash = computeF127Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F127GlobalCmdkOmniSearchValidationError(
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
        featureId: F127_FEATURE_ID,
        operationCode: F127_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          query_string: input.query_string,
          matched_categories: input.matched_categories,
          top_hit_id: input.top_hit_id,
          search_latency_ms: input.search_latency_ms
        }
      });

      const executionId = `exec_f127_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f127_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F127GlobalCmdkOmniSearchAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F127_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `cmdk_omnibox_router:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F127GlobalCmdkOmniSearchOutput = {
        featureId: F127_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F127_OPERATION_CODE,
        resolved_query_string: kernelResult.resolvedFields.query_string as string,
        resolved_matched_categories: kernelResult.resolvedFields.matched_categories as string | number,
        resolved_top_hit_id: kernelResult.resolvedFields.top_hit_id as string | number | boolean | readonly string[],
        resolved_search_latency_ms: kernelResult.resolvedFields.search_latency_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F127GlobalCmdkOmniSearchTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F127_FEATURE_ID,
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

  public getAuditTrail(): readonly F127GlobalCmdkOmniSearchAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F127GlobalCmdkOmniSearchOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF127Module(): {
  featureId: typeof F127_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F127GlobalCmdkOmniSearchEngine();
  const sampleInput: F127GlobalCmdkOmniSearchInput = {
    requestId: "req_verify_f127",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_string: "f127_query_string_seed",
    matched_categories: 42,
    top_hit_id: true,
    search_latency_ms: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 127 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F127" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_string !== sampleInput.query_string &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F127_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
