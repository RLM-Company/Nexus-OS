/**
 * F136 (stage5-enterprise): Политики разрешённых инструментов (Tool Allowlisting)
 * Ограничение списка скиллов и внешних доменов для конкретных агентов и ролей
 * Operation Code: tool_allowlist_enforcer
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

export const F136_FEATURE_ID = "F136" as const;
export const F136_STAGE = "stage5-enterprise" as const;
export const F136_OPERATION_CODE = "tool_allowlist_enforcer" as const;
export const F136_CONTRACT_VERSION = "2.0.0" as const;

export type F136RoleToolAllowlistingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F136RoleToolAllowlistingConfig = BaseFeatureConfig<
  typeof F136_FEATURE_ID,
  typeof F136_STAGE,
  typeof F136_OPERATION_CODE
>;

export interface F136RoleToolAllowlistingInput extends BaseFeatureInput {
  readonly agent_role: string;
  readonly requested_tool_id: string | number;
  readonly allowlist_matched: string | number | boolean | readonly string[];
  readonly enforcement_action: string | number | boolean | Record<string, unknown>;
}

export type F136RoleToolAllowlistingAuditEntry = BaseFeatureAuditEntry<typeof F136_FEATURE_ID>;

export interface F136RoleToolAllowlistingOutput {
  readonly featureId: typeof F136_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F136RoleToolAllowlistingExecutionStatus;
  readonly operationCode: typeof F136_OPERATION_CODE;
  readonly resolved_agent_role: string;
  readonly resolved_requested_tool_id: string | number;
  readonly resolved_allowlist_matched: string | number | boolean | readonly string[];
  readonly resolved_enforcement_action: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F136RoleToolAllowlistingAuditEntry;
}

export type F136RoleToolAllowlistingTelemetrySnapshot = BaseFeatureTelemetry<typeof F136_FEATURE_ID>;

export const DEFAULT_F136_CONFIG: F136RoleToolAllowlistingConfig = {
  featureId: F136_FEATURE_ID,
  stage: F136_STAGE,
  operationCode: F136_OPERATION_CODE,
  contractVersion: F136_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F136RoleToolAllowlistingValidationError extends Error {
  public readonly featureId = F136_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F136 Validation Error on '${field}']: ${message}`);
    this.name = "F136RoleToolAllowlistingValidationError";
    this.field = field;
  }
}

export function computeF136Digest(rawPayload: string): string {
  return `f136_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F136RoleToolAllowlistingEngine extends KosmoraFeatureAdapterBase<
  typeof F136_FEATURE_ID,
  typeof F136_STAGE,
  typeof F136_OPERATION_CODE,
  F136RoleToolAllowlistingConfig,
  F136RoleToolAllowlistingInput,
  F136RoleToolAllowlistingOutput
> {
  constructor(customConfig?: Partial<F136RoleToolAllowlistingConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F136_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["agent_role", "requested_tool_id", "allowlist_matched", "enforcement_action"] as const,
      F136RoleToolAllowlistingValidationError
    );
  }
}

export function verifyF136Module(): {
  featureId: typeof F136_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F136RoleToolAllowlistingEngine();
  const sampleInput: F136RoleToolAllowlistingInput = {
    requestId: "req_verify_f136",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    agent_role: "f136_agent_role_seed",
    requested_tool_id: 42,
    allowlist_matched: true,
    enforcement_action: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 136 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F136" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_role !== sampleInput.agent_role &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F136_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
