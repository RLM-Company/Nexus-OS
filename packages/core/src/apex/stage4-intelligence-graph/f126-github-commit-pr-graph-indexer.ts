/**
 * F126 (stage4-intelligence-graph): Индексация коммитов и PR в граф знаний
 * Автоматическое добавление истории разработки из GitHub в общий граф проекта
 * Operation Code: git_history_graph_indexer
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F126_FEATURE_ID = "F126" as const;
export const F126_STAGE = "stage4-intelligence-graph" as const;
export const F126_OPERATION_CODE = "git_history_graph_indexer" as const;
export const F126_CONTRACT_VERSION = "2.0.0" as const;

export type F126GithubCommitPrGraphIndexerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F126GithubCommitPrGraphIndexerConfig = BaseFeatureConfig<
  typeof F126_FEATURE_ID,
  typeof F126_STAGE,
  typeof F126_OPERATION_CODE
>;

export interface F126GithubCommitPrGraphIndexerInput extends BaseFeatureInput {
  readonly repo_name: string;
  readonly indexed_commits: string | number;
  readonly linked_task_nodes: string | number | boolean | readonly string[];
  readonly graph_edges_added: string | number | boolean | Record<string, unknown>;
}

export type F126GithubCommitPrGraphIndexerAuditEntry = BaseFeatureAuditEntry<
  typeof F126_FEATURE_ID
>;

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

export type F126GithubCommitPrGraphIndexerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F126_FEATURE_ID
>;

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

export class F126GithubCommitPrGraphIndexerEngine extends KosmoraFeatureAdapterBase<
  typeof F126_FEATURE_ID,
  typeof F126_STAGE,
  typeof F126_OPERATION_CODE,
  F126GithubCommitPrGraphIndexerConfig,
  F126GithubCommitPrGraphIndexerInput,
  F126GithubCommitPrGraphIndexerOutput
> {
  constructor(
    customConfig?: Partial<F126GithubCommitPrGraphIndexerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F126_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["repo_name", "indexed_commits", "linked_task_nodes", "graph_edges_added"] as const,
      F126GithubCommitPrGraphIndexerValidationError
    );
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
