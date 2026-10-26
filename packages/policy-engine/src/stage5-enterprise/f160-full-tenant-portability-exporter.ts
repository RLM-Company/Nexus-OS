/**
 * F160 (stage5-enterprise): Экспорт полного дампа проекта (Full Tenant Portability)
 * Выгрузка всех артефактов, истории чатов, графа знаний и скиллов в самодостаточный архив
 * Operation Code: tenant_portability_dumper
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

export const F160_FEATURE_ID = "F160" as const;
export const F160_STAGE = "stage5-enterprise" as const;
export const F160_OPERATION_CODE = "tenant_portability_dumper" as const;
export const F160_CONTRACT_VERSION = "2.0.0" as const;

export type F160FullTenantPortabilityExporterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F160FullTenantPortabilityExporterConfig = BaseFeatureConfig<
  typeof F160_FEATURE_ID,
  typeof F160_STAGE,
  typeof F160_OPERATION_CODE
>;

export interface F160FullTenantPortabilityExporterInput extends BaseFeatureInput {
  readonly export_bundle_id: string;
  readonly tenant_id: string | number;
  readonly manifest_integrity_hash: string | number | boolean | readonly string[];
  readonly self_contained_ready: string | number | boolean | Record<string, unknown>;
}

export type F160FullTenantPortabilityExporterAuditEntry = BaseFeatureAuditEntry<typeof F160_FEATURE_ID>;

export interface F160FullTenantPortabilityExporterOutput {
  readonly featureId: typeof F160_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F160FullTenantPortabilityExporterExecutionStatus;
  readonly operationCode: typeof F160_OPERATION_CODE;
  readonly resolved_export_bundle_id: string;
  readonly resolved_tenant_id: string | number;
  readonly resolved_manifest_integrity_hash: string | number | boolean | readonly string[];
  readonly resolved_self_contained_ready: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F160FullTenantPortabilityExporterAuditEntry;
}

export type F160FullTenantPortabilityExporterTelemetrySnapshot = BaseFeatureTelemetry<typeof F160_FEATURE_ID>;

export const DEFAULT_F160_CONFIG: F160FullTenantPortabilityExporterConfig = {
  featureId: F160_FEATURE_ID,
  stage: F160_STAGE,
  operationCode: F160_OPERATION_CODE,
  contractVersion: F160_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F160FullTenantPortabilityExporterValidationError extends Error {
  public readonly featureId = F160_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F160 Validation Error on '${field}']: ${message}`);
    this.name = "F160FullTenantPortabilityExporterValidationError";
    this.field = field;
  }
}

export function computeF160Digest(rawPayload: string): string {
  return `f160_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F160FullTenantPortabilityExporterEngine extends KosmoraFeatureAdapterBase<
  typeof F160_FEATURE_ID,
  typeof F160_STAGE,
  typeof F160_OPERATION_CODE,
  F160FullTenantPortabilityExporterConfig,
  F160FullTenantPortabilityExporterInput,
  F160FullTenantPortabilityExporterOutput
> {
  constructor(customConfig?: Partial<F160FullTenantPortabilityExporterConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F160_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["export_bundle_id", "tenant_id", "manifest_integrity_hash", "self_contained_ready"] as const,
      F160FullTenantPortabilityExporterValidationError
    );
  }
}

export function verifyF160Module(): {
  featureId: typeof F160_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F160FullTenantPortabilityExporterEngine();
  const sampleInput: F160FullTenantPortabilityExporterInput = {
    requestId: "req_verify_f160",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    export_bundle_id: "f160_export_bundle_id_seed",
    tenant_id: 42,
    manifest_integrity_hash: true,
    self_contained_ready: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 160 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F160" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_export_bundle_id !== sampleInput.export_bundle_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F160_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
