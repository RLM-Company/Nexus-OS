/**
 * F127 (stage4-intelligence-graph): Быстрый глобальный поиск (Cmd/Ctrl + K)
 * Мгновенный переход к любому чату, узлу графа, скиллу или версии артефакта на Canvas
 * Operation Code: cmdk_omnibox_router
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

export const F127_FEATURE_ID = "F127" as const;
export const F127_STAGE = "stage4-intelligence-graph" as const;
export const F127_OPERATION_CODE = "cmdk_omnibox_router" as const;
export const F127_CONTRACT_VERSION = "2.0.0" as const;

export type F127GlobalCmdkOmniSearchExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F127GlobalCmdkOmniSearchConfig = BaseFeatureConfig<
  typeof F127_FEATURE_ID,
  typeof F127_STAGE,
  typeof F127_OPERATION_CODE
>;

export interface F127GlobalCmdkOmniSearchInput extends BaseFeatureInput {
  readonly query_string: string;
  readonly matched_categories: string | number;
  readonly top_hit_id: string | number | boolean | readonly string[];
  readonly search_latency_ms: string | number | boolean | Record<string, unknown>;
}

export type F127GlobalCmdkOmniSearchAuditEntry = BaseFeatureAuditEntry<typeof F127_FEATURE_ID>;

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

export type F127GlobalCmdkOmniSearchTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F127_FEATURE_ID
>;

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

export class F127GlobalCmdkOmniSearchEngine extends KosmoraFeatureAdapterBase<
  typeof F127_FEATURE_ID,
  typeof F127_STAGE,
  typeof F127_OPERATION_CODE,
  F127GlobalCmdkOmniSearchConfig,
  F127GlobalCmdkOmniSearchInput,
  F127GlobalCmdkOmniSearchOutput
> {
  constructor(customConfig?: Partial<F127GlobalCmdkOmniSearchConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F127_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["query_string", "matched_categories", "top_hit_id", "search_latency_ms"] as const,
      F127GlobalCmdkOmniSearchValidationError
    );
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
