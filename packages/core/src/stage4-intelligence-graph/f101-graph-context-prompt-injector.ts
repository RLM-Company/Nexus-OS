/**
 * F101 (stage4-intelligence-graph): Инжектор графового контекста в промпт (Graph Context Injector)
 * Автоматическое подтягивание релевантных узлов графа в системный промпт при старте новой ветки чата
 * Operation Code: prompt_graph_injector
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

export const F101_FEATURE_ID = "F101" as const;
export const F101_STAGE = "stage4-intelligence-graph" as const;
export const F101_OPERATION_CODE = "prompt_graph_injector" as const;
export const F101_CONTRACT_VERSION = "2.0.0" as const;

export type F101GraphContextPromptInjectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F101GraphContextPromptInjectorConfig = BaseFeatureConfig<
  typeof F101_FEATURE_ID,
  typeof F101_STAGE,
  typeof F101_OPERATION_CODE
>;

export interface F101GraphContextPromptInjectorInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly injected_nodes_count: string | number;
  readonly augmented_system_prompt: string | number | boolean | readonly string[];
  readonly token_overhead: string | number | boolean | Record<string, unknown>;
}

export type F101GraphContextPromptInjectorAuditEntry = BaseFeatureAuditEntry<typeof F101_FEATURE_ID>;

export interface F101GraphContextPromptInjectorOutput {
  readonly featureId: typeof F101_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F101GraphContextPromptInjectorExecutionStatus;
  readonly operationCode: typeof F101_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_injected_nodes_count: string | number;
  readonly resolved_augmented_system_prompt: string | number | boolean | readonly string[];
  readonly resolved_token_overhead: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F101GraphContextPromptInjectorAuditEntry;
}

export type F101GraphContextPromptInjectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F101_FEATURE_ID>;

export const DEFAULT_F101_CONFIG: F101GraphContextPromptInjectorConfig = {
  featureId: F101_FEATURE_ID,
  stage: F101_STAGE,
  operationCode: F101_OPERATION_CODE,
  contractVersion: F101_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F101GraphContextPromptInjectorValidationError extends Error {
  public readonly featureId = F101_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F101 Validation Error on '${field}']: ${message}`);
    this.name = "F101GraphContextPromptInjectorValidationError";
    this.field = field;
  }
}

export function computeF101Digest(rawPayload: string): string {
  return `f101_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F101GraphContextPromptInjectorEngine extends KosmoraFeatureAdapterBase<
  typeof F101_FEATURE_ID,
  typeof F101_STAGE,
  typeof F101_OPERATION_CODE,
  F101GraphContextPromptInjectorConfig,
  F101GraphContextPromptInjectorInput,
  F101GraphContextPromptInjectorOutput
> {
  constructor(customConfig?: Partial<F101GraphContextPromptInjectorConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F101_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "injected_nodes_count", "augmented_system_prompt", "token_overhead"] as const,
      F101GraphContextPromptInjectorValidationError
    );
  }
}

export function verifyF101Module(): {
  featureId: typeof F101_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F101GraphContextPromptInjectorEngine();
  const sampleInput: F101GraphContextPromptInjectorInput = {
    requestId: "req_verify_f101",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f101_workspace_id_seed",
    injected_nodes_count: 42,
    augmented_system_prompt: true,
    token_overhead: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 101 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F101" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F101_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
