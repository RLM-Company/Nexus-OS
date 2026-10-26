/**
 * F052 (stage2-canvas): Экспорт и синхронизация с Markdown / Notion
 * Копирование или пуш готовых структурированных материалов с сохранением форматирования
 * Operation Code: markdown_notion_bridge
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F052_FEATURE_ID = "F052" as const;
export const F052_STAGE = "stage2-canvas" as const;
export const F052_OPERATION_CODE = "markdown_notion_bridge" as const;
export const F052_CONTRACT_VERSION = "2.0.0" as const;

export type F052MarkdownNotionSynchronizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F052MarkdownNotionSynchronizerConfig = BaseFeatureConfig<
  typeof F052_FEATURE_ID,
  typeof F052_STAGE,
  typeof F052_OPERATION_CODE
>;

export interface F052MarkdownNotionSynchronizerInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly notion_blocks_count: string | number;
  readonly gfm_markdown: string | number | boolean | readonly string[];
  readonly formatting_preserved: string | number | boolean | Record<string, unknown>;
}

export type F052MarkdownNotionSynchronizerAuditEntry = BaseFeatureAuditEntry<typeof F052_FEATURE_ID>;

export interface F052MarkdownNotionSynchronizerOutput {
  readonly featureId: typeof F052_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F052MarkdownNotionSynchronizerExecutionStatus;
  readonly operationCode: typeof F052_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_notion_blocks_count: string | number;
  readonly resolved_gfm_markdown: string | number | boolean | readonly string[];
  readonly resolved_formatting_preserved: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F052MarkdownNotionSynchronizerAuditEntry;
}

export type F052MarkdownNotionSynchronizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F052_FEATURE_ID>;

export const DEFAULT_F052_CONFIG: F052MarkdownNotionSynchronizerConfig = {
  featureId: F052_FEATURE_ID,
  stage: F052_STAGE,
  operationCode: F052_OPERATION_CODE,
  contractVersion: F052_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F052MarkdownNotionSynchronizerValidationError extends Error {
  public readonly featureId = F052_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F052 Validation Error on '${field}']: ${message}`);
    this.name = "F052MarkdownNotionSynchronizerValidationError";
    this.field = field;
  }
}

export function computeF052Digest(rawPayload: string): string {
  return `f052_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F052MarkdownNotionSynchronizerEngine extends KosmoraFeatureAdapterBase<
  typeof F052_FEATURE_ID,
  typeof F052_STAGE,
  typeof F052_OPERATION_CODE,
  F052MarkdownNotionSynchronizerConfig,
  F052MarkdownNotionSynchronizerInput,
  F052MarkdownNotionSynchronizerOutput
> {
  constructor(customConfig?: Partial<F052MarkdownNotionSynchronizerConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F052_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "notion_blocks_count", "gfm_markdown", "formatting_preserved"] as const,
      F052MarkdownNotionSynchronizerValidationError
    );
  }
}

export function verifyF052Module(): {
  featureId: typeof F052_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F052MarkdownNotionSynchronizerEngine();
  const sampleInput: F052MarkdownNotionSynchronizerInput = {
    requestId: "req_verify_f052",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f052_artifact_id_seed",
    notion_blocks_count: 42,
    gfm_markdown: true,
    formatting_preserved: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 52 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F052" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F052_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
