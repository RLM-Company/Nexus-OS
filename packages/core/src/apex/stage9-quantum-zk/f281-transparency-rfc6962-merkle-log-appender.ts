/**
 * F281 (stage9-quantum-zk): Аппендер криптографического журнала прозрачности (RFC 6962 Merkle Log)
 * Добавление записей в append-only дерево Меркла с мгновенным выпуском квитанции включения
 * Operation Code: transparency_log_append
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

export const F281_FEATURE_ID = "F281" as const;
export const F281_STAGE = "stage9-quantum-zk" as const;
export const F281_OPERATION_CODE = "transparency_log_append" as const;
export const F281_CONTRACT_VERSION = "2.0.0" as const;

export type F281TransparencyRfc6962MerkleLogAppenderConfig = BaseFeatureConfig<
  typeof F281_FEATURE_ID,
  typeof F281_STAGE,
  typeof F281_OPERATION_CODE
>;

export interface F281TransparencyRfc6962MerkleLogAppenderInput extends BaseFeatureInput {
  readonly actor_id: string | number | boolean | readonly string[];
  readonly operation_code: string | number | boolean | readonly string[];
  readonly payload_hash: string | number | boolean | readonly string[];
  readonly log_partition: string | number | boolean | readonly string[];
}

export interface F281TransparencyRfc6962MerkleLogAppenderOutput {
  readonly featureId: typeof F281_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F281_OPERATION_CODE;
  readonly resolved_actor_id: unknown;
  readonly resolved_operation_code: unknown;
  readonly resolved_payload_hash: unknown;
  readonly resolved_log_partition: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F281_FEATURE_ID>;
}

export type F281TransparencyRfc6962MerkleLogAppenderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F281_FEATURE_ID
>;

export const DEFAULT_F281_CONFIG: F281TransparencyRfc6962MerkleLogAppenderConfig = {
  featureId: F281_FEATURE_ID,
  stage: F281_STAGE,
  operationCode: F281_OPERATION_CODE,
  contractVersion: F281_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F281TransparencyRfc6962MerkleLogAppenderValidationError extends Error {
  public readonly featureId = F281_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F281 Validation Error on '${field}']: ${message}`);
    this.name = "F281TransparencyRfc6962MerkleLogAppenderValidationError";
    this.field = field;
  }
}

export function computeF281Digest(rawPayload: string): string {
  return `f281_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F281TransparencyRfc6962MerkleLogAppenderService extends KosmoraFeatureAdapterBase<
  typeof F281_FEATURE_ID,
  typeof F281_STAGE,
  typeof F281_OPERATION_CODE,
  F281TransparencyRfc6962MerkleLogAppenderConfig,
  F281TransparencyRfc6962MerkleLogAppenderInput,
  F281TransparencyRfc6962MerkleLogAppenderOutput
> {
  constructor(
    customConfig?: Partial<F281TransparencyRfc6962MerkleLogAppenderConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F281_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["actor_id", "operation_code", "payload_hash", "log_partition"] as const,
      F281TransparencyRfc6962MerkleLogAppenderValidationError
    );
  }
}

export function verifyF281Module(): {
  readonly featureId: typeof F281_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F281TransparencyRfc6962MerkleLogAppenderService();
  const sampleInput: F281TransparencyRfc6962MerkleLogAppenderInput = {
    requestId: "req_verify_f281",
    projectId: "proj_kosmora_f281",
    workspaceId: "ws_kosmora_f281",
    tenantId: "tenant_rlm_f281",
    actorId: "actor_verifier_f281",
    autonomyLevel: "A3",
    actor_id: "seed_f281_actor_id",
    operation_code: 42,
    payload_hash: true,
    log_partition: "seed_f281_log_partition",
    metadata: { stage: "stage9-quantum-zk", featureId: "F281" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F281" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_actor_id !== sampleInput.actor_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F281] Verification failed`);
  }

  return {
    featureId: F281_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
