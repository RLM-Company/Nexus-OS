/**
 * F077 (stage3-skills-bus): Веб-поиск и скрапинг с очисткой до Markdown
 * Сбор актуальной информации из сети с удалением рекламного шума и навигации
 * Operation Code: clean_web_extractor
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F077_FEATURE_ID = "F077" as const;
export const F077_STAGE = "stage3-skills-bus" as const;
export const F077_OPERATION_CODE = "clean_web_extractor" as const;
export const F077_CONTRACT_VERSION = "2.0.0" as const;

export type F077CleanMarkdownWebScraperExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F077CleanMarkdownWebScraperConfig = BaseFeatureConfig<
  typeof F077_FEATURE_ID,
  typeof F077_STAGE,
  typeof F077_OPERATION_CODE
>;

export interface F077CleanMarkdownWebScraperInput extends BaseFeatureInput {
  readonly source_url: string;
  readonly noise_stripped_pct: string | number;
  readonly clean_markdown: string | number | boolean | readonly string[];
  readonly extracted_links: string | number | boolean | Record<string, unknown>;
}

export type F077CleanMarkdownWebScraperAuditEntry = BaseFeatureAuditEntry<typeof F077_FEATURE_ID>;

export interface F077CleanMarkdownWebScraperOutput {
  readonly featureId: typeof F077_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F077CleanMarkdownWebScraperExecutionStatus;
  readonly operationCode: typeof F077_OPERATION_CODE;
  readonly resolved_source_url: string;
  readonly resolved_noise_stripped_pct: string | number;
  readonly resolved_clean_markdown: string | number | boolean | readonly string[];
  readonly resolved_extracted_links: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F077CleanMarkdownWebScraperAuditEntry;
}

export type F077CleanMarkdownWebScraperTelemetrySnapshot = BaseFeatureTelemetry<typeof F077_FEATURE_ID>;

export const DEFAULT_F077_CONFIG: F077CleanMarkdownWebScraperConfig = {
  featureId: F077_FEATURE_ID,
  stage: F077_STAGE,
  operationCode: F077_OPERATION_CODE,
  contractVersion: F077_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F077CleanMarkdownWebScraperValidationError extends Error {
  public readonly featureId = F077_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F077 Validation Error on '${field}']: ${message}`);
    this.name = "F077CleanMarkdownWebScraperValidationError";
    this.field = field;
  }
}

export function computeF077Digest(rawPayload: string): string {
  return `f077_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F077CleanMarkdownWebScraperEngine extends KosmoraFeatureAdapterBase<
  typeof F077_FEATURE_ID,
  typeof F077_STAGE,
  typeof F077_OPERATION_CODE,
  F077CleanMarkdownWebScraperConfig,
  F077CleanMarkdownWebScraperInput,
  F077CleanMarkdownWebScraperOutput
> {
  constructor(customConfig?: Partial<F077CleanMarkdownWebScraperConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F077_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["source_url", "noise_stripped_pct", "clean_markdown", "extracted_links"] as const,
      F077CleanMarkdownWebScraperValidationError
    );
  }
  protected override validateDomainInvariants(input: F077CleanMarkdownWebScraperInput): void {
    if (typeof input.noise_stripped_pct === "number" && input.noise_stripped_pct > 1000) {
      throw new F077CleanMarkdownWebScraperValidationError("noise_stripped_pct", "Metric 'noise_stripped_pct' exceeds maximum normalized ceiling (1000).");
    }
  }
}

export function verifyF077Module(): {
  featureId: typeof F077_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F077CleanMarkdownWebScraperEngine();
  const sampleInput: F077CleanMarkdownWebScraperInput = {
    requestId: "req_verify_f077",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_url: "f077_source_url_seed",
    noise_stripped_pct: 42,
    clean_markdown: true,
    extracted_links: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 77 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F077" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_url !== sampleInput.source_url &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F077_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
