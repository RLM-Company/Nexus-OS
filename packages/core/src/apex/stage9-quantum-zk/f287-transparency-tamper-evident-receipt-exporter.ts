/**
 * F287 (stage9-quantum-zk): Экспортер криптографических квитанций прозрачности для внешнего аудита
 * Формирование самодостаточного JSON-пакета с путём Меркла, ZK-доказательством и PQC-подписью
 * Operation Code: transparency_receipt_export
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
import { Stage9QuantumZkKernel } from "./stage-kernel.js";

export const F287_FEATURE_ID = "F287" as const;
export const F287_STAGE = "stage9-quantum-zk" as const;
export const F287_OPERATION_CODE = "transparency_receipt_export" as const;
export const F287_CONTRACT_VERSION = "2.0.0" as const;

export type F287TransparencyTamperEvidentReceiptExporterConfig = BaseFeatureConfig<
  typeof F287_FEATURE_ID,
  typeof F287_STAGE,
  typeof F287_OPERATION_CODE
>;

export interface F287TransparencyTamperEvidentReceiptExporterInput extends BaseFeatureInput {
  readonly receipt_target_id: string | number | boolean | readonly string[];
  readonly inclusion_path: string | number | boolean | readonly string[];
  readonly sth_signature: string | number | boolean | readonly string[];
  readonly export_format: string | number | boolean | readonly string[];
}

export interface F287TransparencyTamperEvidentReceiptExporterOutput {
  readonly featureId: typeof F287_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F287_OPERATION_CODE;
  readonly resolved_receipt_target_id: unknown;
  readonly resolved_inclusion_path: unknown;
  readonly resolved_sth_signature: unknown;
  readonly resolved_export_format: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F287_FEATURE_ID>;
}

export type F287TransparencyTamperEvidentReceiptExporterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F287_FEATURE_ID
>;

export const DEFAULT_F287_CONFIG: F287TransparencyTamperEvidentReceiptExporterConfig = {
  featureId: F287_FEATURE_ID,
  stage: F287_STAGE,
  operationCode: F287_OPERATION_CODE,
  contractVersion: F287_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F287TransparencyTamperEvidentReceiptExporterValidationError extends Error {
  public readonly featureId = F287_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F287 Validation Error on '${field}']: ${message}`);
    this.name = "F287TransparencyTamperEvidentReceiptExporterValidationError";
    this.field = field;
  }
}

export function computeF287Digest(rawPayload: string): string {
  return `f287_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F287TransparencyTamperEvidentReceiptExporterService extends KosmoraFeatureAdapterBase<
  typeof F287_FEATURE_ID,
  typeof F287_STAGE,
  typeof F287_OPERATION_CODE,
  F287TransparencyTamperEvidentReceiptExporterConfig,
  F287TransparencyTamperEvidentReceiptExporterInput,
  F287TransparencyTamperEvidentReceiptExporterOutput
> {
  constructor(
    customConfig?: Partial<F287TransparencyTamperEvidentReceiptExporterConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F287_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["receipt_target_id", "inclusion_path", "sth_signature", "export_format"] as const,
      F287TransparencyTamperEvidentReceiptExporterValidationError
    );
  }
}

export function verifyF287Module(): {
  readonly featureId: typeof F287_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F287TransparencyTamperEvidentReceiptExporterService();
  const sampleInput: F287TransparencyTamperEvidentReceiptExporterInput = {
    requestId: "req_verify_f287",
    projectId: "proj_kosmora_f287",
    workspaceId: "ws_kosmora_f287",
    tenantId: "tenant_rlm_f287",
    actorId: "actor_verifier_f287",
    autonomyLevel: "A3",
    receipt_target_id: "seed_f287_receipt_target_id",
    inclusion_path: 42,
    sth_signature: true,
    export_format: "seed_f287_export_format",
    metadata: { stage: "stage9-quantum-zk", featureId: "F287" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F287" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_receipt_target_id !== sampleInput.receipt_target_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F287] Verification failed`);
  }

  return {
    featureId: F287_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
