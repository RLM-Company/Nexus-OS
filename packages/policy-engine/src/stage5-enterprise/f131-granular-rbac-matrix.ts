/**
 * F131 (stage5-enterprise): Ролевая модель доступа (RBAC)
 * Гранулярные права: Owner, Admin, Architect, Operator, Viewer на уровне воркспейсов и артефактов
 * Operation Code: rbac_permission_evaluator
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

export const F131_FEATURE_ID = "F131" as const;
export const F131_STAGE = "stage5-enterprise" as const;
export const F131_OPERATION_CODE = "rbac_permission_evaluator" as const;
export const F131_CONTRACT_VERSION = "2.0.0" as const;

export type F131GranularRbacMatrixExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F131GranularRbacMatrixConfig = BaseFeatureConfig<
  typeof F131_FEATURE_ID,
  typeof F131_STAGE,
  typeof F131_OPERATION_CODE
>;

export interface F131GranularRbacMatrixInput extends BaseFeatureInput {
  readonly actor_role: string;
  readonly requested_capability: string | number;
  readonly resource_scope: string | number | boolean | readonly string[];
  readonly verdict_allowed: string | number | boolean | Record<string, unknown>;
}

export type F131GranularRbacMatrixAuditEntry = BaseFeatureAuditEntry<typeof F131_FEATURE_ID>;

export interface F131GranularRbacMatrixOutput {
  readonly featureId: typeof F131_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F131GranularRbacMatrixExecutionStatus;
  readonly operationCode: typeof F131_OPERATION_CODE;
  readonly resolved_actor_role: string;
  readonly resolved_requested_capability: string | number;
  readonly resolved_resource_scope: string | number | boolean | readonly string[];
  readonly resolved_verdict_allowed: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F131GranularRbacMatrixAuditEntry;
}

export type F131GranularRbacMatrixTelemetrySnapshot = BaseFeatureTelemetry<typeof F131_FEATURE_ID>;

export const DEFAULT_F131_CONFIG: F131GranularRbacMatrixConfig = {
  featureId: F131_FEATURE_ID,
  stage: F131_STAGE,
  operationCode: F131_OPERATION_CODE,
  contractVersion: F131_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F131GranularRbacMatrixValidationError extends Error {
  public readonly featureId = F131_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F131 Validation Error on '${field}']: ${message}`);
    this.name = "F131GranularRbacMatrixValidationError";
    this.field = field;
  }
}

export function computeF131Digest(rawPayload: string): string {
  return `f131_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F131GranularRbacMatrixEngine extends KosmoraFeatureAdapterBase<
  typeof F131_FEATURE_ID,
  typeof F131_STAGE,
  typeof F131_OPERATION_CODE,
  F131GranularRbacMatrixConfig,
  F131GranularRbacMatrixInput,
  F131GranularRbacMatrixOutput
> {
  constructor(customConfig?: Partial<F131GranularRbacMatrixConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F131_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["actor_role", "requested_capability", "resource_scope", "verdict_allowed"] as const,
      F131GranularRbacMatrixValidationError
    );
  }
}

export function verifyF131Module(): {
  featureId: typeof F131_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F131GranularRbacMatrixEngine();
  const sampleInput: F131GranularRbacMatrixInput = {
    requestId: "req_verify_f131",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    actor_role: "f131_actor_role_seed",
    requested_capability: 42,
    resource_scope: true,
    verdict_allowed: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 131 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F131" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_actor_role !== sampleInput.actor_role &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F131_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
