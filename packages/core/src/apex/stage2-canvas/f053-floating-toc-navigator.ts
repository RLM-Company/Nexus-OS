/**
 * F053 (stage2-canvas): Оглавление и быстрая навигация по длинным отчётам
 * Плавающее дерево заголовков (H1–H4) для документов свыше 10 страниц
 * Operation Code: floating_toc_tree
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

export const F053_FEATURE_ID = "F053" as const;
export const F053_STAGE = "stage2-canvas" as const;
export const F053_OPERATION_CODE = "floating_toc_tree" as const;
export const F053_CONTRACT_VERSION = "2.0.0" as const;

export type F053FloatingTocNavigatorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F053FloatingTocNavigatorConfig = BaseFeatureConfig<
  typeof F053_FEATURE_ID,
  typeof F053_STAGE,
  typeof F053_OPERATION_CODE
>;

export interface F053FloatingTocNavigatorInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly headings_extracted: string | number;
  readonly max_depth: string | number | boolean | readonly string[];
  readonly active_anchor_slug: string | number | boolean | Record<string, unknown>;
}

export type F053FloatingTocNavigatorAuditEntry = BaseFeatureAuditEntry<typeof F053_FEATURE_ID>;

export interface F053FloatingTocNavigatorOutput {
  readonly featureId: typeof F053_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F053FloatingTocNavigatorExecutionStatus;
  readonly operationCode: typeof F053_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_headings_extracted: string | number;
  readonly resolved_max_depth: string | number | boolean | readonly string[];
  readonly resolved_active_anchor_slug: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F053FloatingTocNavigatorAuditEntry;
}

export type F053FloatingTocNavigatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F053_FEATURE_ID
>;

export const DEFAULT_F053_CONFIG: F053FloatingTocNavigatorConfig = {
  featureId: F053_FEATURE_ID,
  stage: F053_STAGE,
  operationCode: F053_OPERATION_CODE,
  contractVersion: F053_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F053FloatingTocNavigatorValidationError extends Error {
  public readonly featureId = F053_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F053 Validation Error on '${field}']: ${message}`);
    this.name = "F053FloatingTocNavigatorValidationError";
    this.field = field;
  }
}

export function computeF053Digest(rawPayload: string): string {
  return `f053_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F053FloatingTocNavigatorEngine extends KosmoraFeatureAdapterBase<
  typeof F053_FEATURE_ID,
  typeof F053_STAGE,
  typeof F053_OPERATION_CODE,
  F053FloatingTocNavigatorConfig,
  F053FloatingTocNavigatorInput,
  F053FloatingTocNavigatorOutput
> {
  constructor(customConfig?: Partial<F053FloatingTocNavigatorConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F053_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["document_id", "headings_extracted", "max_depth", "active_anchor_slug"] as const,
      F053FloatingTocNavigatorValidationError
    );
  }
}

export function verifyF053Module(): {
  featureId: typeof F053_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F053FloatingTocNavigatorEngine();
  const sampleInput: F053FloatingTocNavigatorInput = {
    requestId: "req_verify_f053",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f053_document_id_seed",
    headings_extracted: 42,
    max_depth: true,
    active_anchor_slug: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 53 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F053" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F053_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
