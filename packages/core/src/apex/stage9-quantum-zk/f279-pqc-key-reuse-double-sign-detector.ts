/**
 * F279 (stage9-quantum-zk): Детектор повторного использования одноразового постквантового ключа
 * Предотвращение деградации стойкости OTS при попытке подписать два разных сообщения одним листом
 * Operation Code: pqc_double_sign_detect
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

export const F279_FEATURE_ID = "F279" as const;
export const F279_STAGE = "stage9-quantum-zk" as const;
export const F279_OPERATION_CODE = "pqc_double_sign_detect" as const;
export const F279_CONTRACT_VERSION = "2.0.0" as const;

export type F279PqcKeyReuseDoubleSignDetectorConfig = BaseFeatureConfig<
  typeof F279_FEATURE_ID,
  typeof F279_STAGE,
  typeof F279_OPERATION_CODE
>;

export interface F279PqcKeyReuseDoubleSignDetectorInput extends BaseFeatureInput {
  readonly public_key_root: string | number | boolean | readonly string[];
  readonly message_digest_a: string | number | boolean | readonly string[];
  readonly message_digest_b: string | number | boolean | readonly string[];
  readonly revocation_hook: string | number | boolean | readonly string[];
}

export interface F279PqcKeyReuseDoubleSignDetectorOutput {
  readonly featureId: typeof F279_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F279_OPERATION_CODE;
  readonly resolved_public_key_root: unknown;
  readonly resolved_message_digest_a: unknown;
  readonly resolved_message_digest_b: unknown;
  readonly resolved_revocation_hook: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F279_FEATURE_ID>;
}

export type F279PqcKeyReuseDoubleSignDetectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F279_FEATURE_ID
>;

export const DEFAULT_F279_CONFIG: F279PqcKeyReuseDoubleSignDetectorConfig = {
  featureId: F279_FEATURE_ID,
  stage: F279_STAGE,
  operationCode: F279_OPERATION_CODE,
  contractVersion: F279_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F279PqcKeyReuseDoubleSignDetectorValidationError extends Error {
  public readonly featureId = F279_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F279 Validation Error on '${field}']: ${message}`);
    this.name = "F279PqcKeyReuseDoubleSignDetectorValidationError";
    this.field = field;
  }
}

export function computeF279Digest(rawPayload: string): string {
  return `f279_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F279PqcKeyReuseDoubleSignDetectorService extends KosmoraFeatureAdapterBase<
  typeof F279_FEATURE_ID,
  typeof F279_STAGE,
  typeof F279_OPERATION_CODE,
  F279PqcKeyReuseDoubleSignDetectorConfig,
  F279PqcKeyReuseDoubleSignDetectorInput,
  F279PqcKeyReuseDoubleSignDetectorOutput
> {
  constructor(
    customConfig?: Partial<F279PqcKeyReuseDoubleSignDetectorConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F279_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["public_key_root", "message_digest_a", "message_digest_b", "revocation_hook"] as const,
      F279PqcKeyReuseDoubleSignDetectorValidationError
    );
  }
}

export function verifyF279Module(): {
  readonly featureId: typeof F279_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F279PqcKeyReuseDoubleSignDetectorService();
  const sampleInput: F279PqcKeyReuseDoubleSignDetectorInput = {
    requestId: "req_verify_f279",
    projectId: "proj_kosmora_f279",
    workspaceId: "ws_kosmora_f279",
    tenantId: "tenant_rlm_f279",
    actorId: "actor_verifier_f279",
    autonomyLevel: "A3",
    public_key_root: "seed_f279_public_key_root",
    message_digest_a: 42,
    message_digest_b: true,
    revocation_hook: "seed_f279_revocation_hook",
    metadata: { stage: "stage9-quantum-zk", featureId: "F279" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F279" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_public_key_root !== sampleInput.public_key_root &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F279] Verification failed`);
  }

  return {
    featureId: F279_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
