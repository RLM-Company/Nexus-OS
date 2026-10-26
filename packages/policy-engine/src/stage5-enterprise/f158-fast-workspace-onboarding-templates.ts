/**
 * F158 (stage5-enterprise): Шаблоны быстрого онбординга воркспейсов
 * Развёртывание преднастроенного пространства с демо-графом, скиллами и примерами на Canvas за 30 секунд
 * Operation Code: instant_onboarding_seeder
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F158_FEATURE_ID = "F158" as const;
export const F158_STAGE = "stage5-enterprise" as const;
export const F158_OPERATION_CODE = "instant_onboarding_seeder" as const;
export const F158_CONTRACT_VERSION = "2.0.0" as const;

export type F158FastWorkspaceOnboardingTemplatesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F158FastWorkspaceOnboardingTemplatesConfig = BaseFeatureConfig<
  typeof F158_FEATURE_ID,
  typeof F158_STAGE,
  typeof F158_OPERATION_CODE
>;

export interface F158FastWorkspaceOnboardingTemplatesInput extends BaseFeatureInput {
  readonly template_name: string;
  readonly seeded_nodes_count: string | number;
  readonly seeded_skills_count: string | number | boolean | readonly string[];
  readonly elapsed_ms: string | number | boolean | Record<string, unknown>;
}

export type F158FastWorkspaceOnboardingTemplatesAuditEntry = BaseFeatureAuditEntry<typeof F158_FEATURE_ID>;

export interface F158FastWorkspaceOnboardingTemplatesOutput {
  readonly featureId: typeof F158_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F158FastWorkspaceOnboardingTemplatesExecutionStatus;
  readonly operationCode: typeof F158_OPERATION_CODE;
  readonly resolved_template_name: string;
  readonly resolved_seeded_nodes_count: string | number;
  readonly resolved_seeded_skills_count: string | number | boolean | readonly string[];
  readonly resolved_elapsed_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F158FastWorkspaceOnboardingTemplatesAuditEntry;
}

export type F158FastWorkspaceOnboardingTemplatesTelemetrySnapshot = BaseFeatureTelemetry<typeof F158_FEATURE_ID>;

export const DEFAULT_F158_CONFIG: F158FastWorkspaceOnboardingTemplatesConfig = {
  featureId: F158_FEATURE_ID,
  stage: F158_STAGE,
  operationCode: F158_OPERATION_CODE,
  contractVersion: F158_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F158FastWorkspaceOnboardingTemplatesValidationError extends Error {
  public readonly featureId = F158_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F158 Validation Error on '${field}']: ${message}`);
    this.name = "F158FastWorkspaceOnboardingTemplatesValidationError";
    this.field = field;
  }
}

export function computeF158Digest(rawPayload: string): string {
  return `f158_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F158FastWorkspaceOnboardingTemplatesEngine extends KosmoraFeatureAdapterBase<
  typeof F158_FEATURE_ID,
  typeof F158_STAGE,
  typeof F158_OPERATION_CODE,
  F158FastWorkspaceOnboardingTemplatesConfig,
  F158FastWorkspaceOnboardingTemplatesInput,
  F158FastWorkspaceOnboardingTemplatesOutput
> {
  constructor(customConfig?: Partial<F158FastWorkspaceOnboardingTemplatesConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F158_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["template_name", "seeded_nodes_count", "seeded_skills_count", "elapsed_ms"] as const,
      F158FastWorkspaceOnboardingTemplatesValidationError
    );
  }
}

export function verifyF158Module(): {
  featureId: typeof F158_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F158FastWorkspaceOnboardingTemplatesEngine();
  const sampleInput: F158FastWorkspaceOnboardingTemplatesInput = {
    requestId: "req_verify_f158",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    template_name: "f158_template_name_seed",
    seeded_nodes_count: 42,
    seeded_skills_count: true,
    elapsed_ms: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 158 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F158" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_template_name !== sampleInput.template_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F158_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
