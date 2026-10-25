/**
 * F126 (stage4-intelligence-graph): Индексация коммитов и PR в граф знаний
 * Автоматическое добавление истории разработки из GitHub в общий граф проекта
 * Operation Code: git_history_graph_indexer
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F126_FEATURE_ID = "F126" as const;
export const F126_STAGE = "stage4-intelligence-graph" as const;
export const F126_OPERATION_CODE = "git_history_graph_indexer" as const;
export const F126_CONTRACT_VERSION = "2.0.0" as const;

export type F126GithubCommitPrGraphIndexerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F126GithubCommitPrGraphIndexerConfig {
  readonly featureId: typeof F126_FEATURE_ID;
  readonly stage: typeof F126_STAGE;
  readonly operationCode: typeof F126_OPERATION_CODE;
  readonly contractVersion: typeof F126_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F126GithubCommitPrGraphIndexerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly repo_name: string;
  readonly indexed_commits: string | number;
  readonly linked_task_nodes: string | number | boolean | readonly string[];
  readonly graph_edges_added: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F126GithubCommitPrGraphIndexerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F126_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F126GithubCommitPrGraphIndexerOutput {
  readonly featureId: typeof F126_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F126GithubCommitPrGraphIndexerExecutionStatus;
  readonly operationCode: typeof F126_OPERATION_CODE;
  readonly resolved_repo_name: string;
  readonly resolved_indexed_commits: string | number;
  readonly resolved_linked_task_nodes: string | number | boolean | readonly string[];
  readonly resolved_graph_edges_added: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F126GithubCommitPrGraphIndexerAuditEntry;
}

export interface F126GithubCommitPrGraphIndexerTelemetrySnapshot {
  readonly featureId: typeof F126_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F126_CONFIG: F126GithubCommitPrGraphIndexerConfig = {
  featureId: F126_FEATURE_ID,
  stage: F126_STAGE,
  operationCode: F126_OPERATION_CODE,
  contractVersion: F126_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F126GithubCommitPrGraphIndexerValidationError extends Error {
  public readonly featureId = F126_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F126 Validation Error on '${field}']: ${message}`);
    this.name = "F126GithubCommitPrGraphIndexerValidationError";
    this.field = field;
  }
}

export function computeF126Digest(rawPayload: string): string {
  return `f126_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F126GithubCommitPrGraphIndexerEngine {
  private readonly config: F126GithubCommitPrGraphIndexerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F126GithubCommitPrGraphIndexerOutput[] = [];
  private readonly auditLog: F126GithubCommitPrGraphIndexerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F126GithubCommitPrGraphIndexerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F126GithubCommitPrGraphIndexerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F126_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F126GithubCommitPrGraphIndexerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F126GithubCommitPrGraphIndexerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F126GithubCommitPrGraphIndexerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.repo_name).trim().length === 0) {
      throw new F126GithubCommitPrGraphIndexerValidationError("repo_name", "Primary domain attribute 'repo_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      repo_name: input.repo_name,
      indexed_commits: input.indexed_commits,
      linked_task_nodes: input.linked_task_nodes,
      graph_edges_added: input.graph_edges_added
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F126GithubCommitPrGraphIndexerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F126GithubCommitPrGraphIndexerInput): F126GithubCommitPrGraphIndexerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F126_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        repo_name: input.repo_name,
        indexed_commits: input.indexed_commits,
        linked_task_nodes: input.linked_task_nodes,
        graph_edges_added: input.graph_edges_added
      });
      const payloadHash = computeF126Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F126GithubCommitPrGraphIndexerValidationError(
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
        featureId: F126_FEATURE_ID,
        operationCode: F126_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          repo_name: input.repo_name,
          indexed_commits: input.indexed_commits,
          linked_task_nodes: input.linked_task_nodes,
          graph_edges_added: input.graph_edges_added
        }
      });

      const executionId = `exec_f126_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f126_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F126GithubCommitPrGraphIndexerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F126_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `git_history_graph_indexer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F126GithubCommitPrGraphIndexerOutput = {
        featureId: F126_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F126_OPERATION_CODE,
        resolved_repo_name: kernelResult.resolvedFields.repo_name as string,
        resolved_indexed_commits: kernelResult.resolvedFields.indexed_commits as string | number,
        resolved_linked_task_nodes: kernelResult.resolvedFields.linked_task_nodes as string | number | boolean | readonly string[],
        resolved_graph_edges_added: kernelResult.resolvedFields.graph_edges_added as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F126GithubCommitPrGraphIndexerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F126_FEATURE_ID,
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

  public getAuditTrail(): readonly F126GithubCommitPrGraphIndexerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F126GithubCommitPrGraphIndexerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF126Module(): {
  featureId: typeof F126_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F126GithubCommitPrGraphIndexerEngine();
  const sampleInput: F126GithubCommitPrGraphIndexerInput = {
    requestId: "req_verify_f126",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    repo_name: "f126_repo_name_seed",
    indexed_commits: 42,
    linked_task_nodes: true,
    graph_edges_added: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 126 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F126" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_repo_name !== sampleInput.repo_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F126_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
