/**
 * F066 (stage3-skills-bus): Магазин и реестр внутренних скиллов (Skills Registry)
 * Каталог доступных навыков с описанием входных параметров, версий и требуемых прав
 * Operation Code: skills_catalog_registry
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

export const F066_FEATURE_ID = "F066" as const;
export const F066_STAGE = "stage3-skills-bus" as const;
export const F066_OPERATION_CODE = "skills_catalog_registry" as const;
export const F066_CONTRACT_VERSION = "2.0.0" as const;

export type F066InternalSkillsRegistryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F066InternalSkillsRegistryConfig = BaseFeatureConfig<
  typeof F066_FEATURE_ID,
  typeof F066_STAGE,
  typeof F066_OPERATION_CODE
>;

export interface F066InternalSkillsRegistryInput extends BaseFeatureInput {
  readonly skill_id: string;
  readonly version: string | number;
  readonly required_scopes: string | number | boolean | readonly string[];
  readonly registered_count: string | number | boolean | Record<string, unknown>;
}

export type F066InternalSkillsRegistryAuditEntry = BaseFeatureAuditEntry<typeof F066_FEATURE_ID>;

export interface F066InternalSkillsRegistryOutput {
  readonly featureId: typeof F066_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F066InternalSkillsRegistryExecutionStatus;
  readonly operationCode: typeof F066_OPERATION_CODE;
  readonly resolved_skill_id: string;
  readonly resolved_version: string | number;
  readonly resolved_required_scopes: string | number | boolean | readonly string[];
  readonly resolved_registered_count: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F066InternalSkillsRegistryAuditEntry;
}

export type F066InternalSkillsRegistryTelemetrySnapshot = BaseFeatureTelemetry<typeof F066_FEATURE_ID>;

export const DEFAULT_F066_CONFIG: F066InternalSkillsRegistryConfig = {
  featureId: F066_FEATURE_ID,
  stage: F066_STAGE,
  operationCode: F066_OPERATION_CODE,
  contractVersion: F066_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F066InternalSkillsRegistryValidationError extends Error {
  public readonly featureId = F066_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F066 Validation Error on '${field}']: ${message}`);
    this.name = "F066InternalSkillsRegistryValidationError";
    this.field = field;
  }
}

export function computeF066Digest(rawPayload: string): string {
  return `f066_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F066InternalSkillsRegistryEngine extends KosmoraFeatureAdapterBase<
  typeof F066_FEATURE_ID,
  typeof F066_STAGE,
  typeof F066_OPERATION_CODE,
  F066InternalSkillsRegistryConfig,
  F066InternalSkillsRegistryInput,
  F066InternalSkillsRegistryOutput
> {
  constructor(customConfig?: Partial<F066InternalSkillsRegistryConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F066_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["skill_id", "version", "required_scopes", "registered_count"] as const,
      F066InternalSkillsRegistryValidationError
    );
  }
}

export function verifyF066Module(): {
  featureId: typeof F066_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F066InternalSkillsRegistryEngine();
  const sampleInput: F066InternalSkillsRegistryInput = {
    requestId: "req_verify_f066",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_id: "f066_skill_id_seed",
    version: 42,
    required_scopes: true,
    registered_count: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 66 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F066" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_skill_id !== sampleInput.skill_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F066_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
