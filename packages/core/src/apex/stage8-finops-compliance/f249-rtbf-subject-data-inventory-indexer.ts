/**
 * F249 (stage8-finops-compliance): Индексатор персональных данных субъектов по контурам хранения (GDPR / 152-ФЗ Inventory)
 * Учёт привязки записей субъекта к воркспейсам, векторным индексам, кэшам и архивам
 * Operation Code: rtbf_subject_data_inventory_indexer
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F249_FEATURE_ID = "F249" as const;
export const F249_STAGE = "stage8-finops-compliance" as const;
export const F249_OPERATION_CODE = "rtbf_subject_data_inventory_indexer" as const;
export const F249_CONTRACT_VERSION = "2.0.0" as const;

export type F249RtbfSubjectDataInventoryIndexerConfig = BaseFeatureConfig<
  typeof F249_FEATURE_ID,
  typeof F249_STAGE,
  typeof F249_OPERATION_CODE
>;

export interface F249RtbfSubjectDataInventoryIndexerInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly subject_id: string | number | boolean | readonly string[];
  readonly indexed_records_count: string | number | boolean | readonly string[];
  readonly stores_covered: string | number | boolean | readonly string[];
}

export interface F249RtbfSubjectDataInventoryIndexerOutput {
  readonly featureId: typeof F249_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F249_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_subject_id: unknown;
  readonly resolved_indexed_records_count: unknown;
  readonly resolved_stores_covered: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F249_FEATURE_ID>;
}

export type F249RtbfSubjectDataInventoryIndexerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F249_FEATURE_ID
>;

export const DEFAULT_F249_CONFIG: F249RtbfSubjectDataInventoryIndexerConfig = {
  featureId: F249_FEATURE_ID,
  stage: F249_STAGE,
  operationCode: F249_OPERATION_CODE,
  contractVersion: F249_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F249RtbfSubjectDataInventoryIndexerValidationError extends Error {
  public readonly featureId = F249_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F249 Validation Error on '${field}']: ${message}`);
    this.name = "F249RtbfSubjectDataInventoryIndexerValidationError";
    this.field = field;
  }
}

export function computeF249Digest(rawPayload: string): string {
  return `f249_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F249RtbfSubjectDataInventoryIndexerService extends KosmoraFeatureAdapterBase<
  typeof F249_FEATURE_ID,
  typeof F249_STAGE,
  typeof F249_OPERATION_CODE,
  F249RtbfSubjectDataInventoryIndexerConfig,
  F249RtbfSubjectDataInventoryIndexerInput,
  F249RtbfSubjectDataInventoryIndexerOutput
> {
  constructor(
    customConfig?: Partial<F249RtbfSubjectDataInventoryIndexerConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F249_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "subject_id", "indexed_records_count", "stores_covered"] as const,
      F249RtbfSubjectDataInventoryIndexerValidationError
    );
  }
}

export function verifyF249Module(): {
  readonly featureId: typeof F249_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F249RtbfSubjectDataInventoryIndexerService();
  const sampleInput: F249RtbfSubjectDataInventoryIndexerInput = {
    requestId: "req_verify_f249",
    projectId: "proj_kosmora_f249",
    workspaceId: "ws_kosmora_f249",
    tenantId: "tenant_rlm_f249",
    actorId: "actor_verifier_f249",
    autonomyLevel: "A3",
    tenant_id: "seed_f249_tenant_id",
    subject_id: 42,
    indexed_records_count: true,
    stores_covered: "seed_f249_stores_covered",
    metadata: { stage: "stage8-finops-compliance", featureId: "F249" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F249" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F249] Verification failed`);
  }

  return {
    featureId: F249_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
