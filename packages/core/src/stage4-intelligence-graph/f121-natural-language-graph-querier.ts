/**
 * F121 (stage4-intelligence-graph): Запросы к графу на естественном языке
 * Перевод вопроса пользователя в обход узлов графа для точных ответов по связям
 * Operation Code: nl_graph_traversal
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

export const F121_FEATURE_ID = "F121" as const;
export const F121_STAGE = "stage4-intelligence-graph" as const;
export const F121_OPERATION_CODE = "nl_graph_traversal" as const;
export const F121_CONTRACT_VERSION = "2.0.0" as const;

export type F121NaturalLanguageGraphQuerierExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F121NaturalLanguageGraphQuerierConfig = BaseFeatureConfig<
  typeof F121_FEATURE_ID,
  typeof F121_STAGE,
  typeof F121_OPERATION_CODE
>;

export interface F121NaturalLanguageGraphQuerierInput extends BaseFeatureInput {
  readonly natural_question: string;
  readonly cypher_like_plan: string | number;
  readonly traversed_path: string | number | boolean | readonly string[];
  readonly synthesized_answer: string | number | boolean | Record<string, unknown>;
}

export type F121NaturalLanguageGraphQuerierAuditEntry = BaseFeatureAuditEntry<typeof F121_FEATURE_ID>;

export interface F121NaturalLanguageGraphQuerierOutput {
  readonly featureId: typeof F121_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F121NaturalLanguageGraphQuerierExecutionStatus;
  readonly operationCode: typeof F121_OPERATION_CODE;
  readonly resolved_natural_question: string;
  readonly resolved_cypher_like_plan: string | number;
  readonly resolved_traversed_path: string | number | boolean | readonly string[];
  readonly resolved_synthesized_answer: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F121NaturalLanguageGraphQuerierAuditEntry;
}

export type F121NaturalLanguageGraphQuerierTelemetrySnapshot = BaseFeatureTelemetry<typeof F121_FEATURE_ID>;

export const DEFAULT_F121_CONFIG: F121NaturalLanguageGraphQuerierConfig = {
  featureId: F121_FEATURE_ID,
  stage: F121_STAGE,
  operationCode: F121_OPERATION_CODE,
  contractVersion: F121_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F121NaturalLanguageGraphQuerierValidationError extends Error {
  public readonly featureId = F121_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F121 Validation Error on '${field}']: ${message}`);
    this.name = "F121NaturalLanguageGraphQuerierValidationError";
    this.field = field;
  }
}

export function computeF121Digest(rawPayload: string): string {
  return `f121_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F121NaturalLanguageGraphQuerierEngine extends KosmoraFeatureAdapterBase<
  typeof F121_FEATURE_ID,
  typeof F121_STAGE,
  typeof F121_OPERATION_CODE,
  F121NaturalLanguageGraphQuerierConfig,
  F121NaturalLanguageGraphQuerierInput,
  F121NaturalLanguageGraphQuerierOutput
> {
  constructor(customConfig?: Partial<F121NaturalLanguageGraphQuerierConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F121_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["natural_question", "cypher_like_plan", "traversed_path", "synthesized_answer"] as const,
      F121NaturalLanguageGraphQuerierValidationError
    );
  }
}

export function verifyF121Module(): {
  featureId: typeof F121_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F121NaturalLanguageGraphQuerierEngine();
  const sampleInput: F121NaturalLanguageGraphQuerierInput = {
    requestId: "req_verify_f121",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    natural_question: "f121_natural_question_seed",
    cypher_like_plan: 42,
    traversed_path: true,
    synthesized_answer: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 121 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F121" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_natural_question !== sampleInput.natural_question &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F121_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
