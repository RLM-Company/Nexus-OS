/**
 * F274 (stage9-quantum-zk): Монитор криптографической корректности (Soundness) и перехвата поддельных ZK-доказательств
 * Мгновенная отбраковка сфальсифицированных откликов s и неверных обязательств t
 * Operation Code: zk_soundness_monitor
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

export const F274_FEATURE_ID = "F274" as const;
export const F274_STAGE = "stage9-quantum-zk" as const;
export const F274_OPERATION_CODE = "zk_soundness_monitor" as const;
export const F274_CONTRACT_VERSION = "2.0.0" as const;

export type F274ZkSoundnessCheatDetectionMonitorConfig = BaseFeatureConfig<
  typeof F274_FEATURE_ID,
  typeof F274_STAGE,
  typeof F274_OPERATION_CODE
>;

export interface F274ZkSoundnessCheatDetectionMonitorInput extends BaseFeatureInput {
  readonly proof_transcript_id: string | number | boolean | readonly string[];
  readonly lhs_verification_hex: string | number | boolean | readonly string[];
  readonly rhs_expected_hex: string | number | boolean | readonly string[];
  readonly penalty_action: string | number | boolean | readonly string[];
}

export interface F274ZkSoundnessCheatDetectionMonitorOutput {
  readonly featureId: typeof F274_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F274_OPERATION_CODE;
  readonly resolved_proof_transcript_id: unknown;
  readonly resolved_lhs_verification_hex: unknown;
  readonly resolved_rhs_expected_hex: unknown;
  readonly resolved_penalty_action: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F274_FEATURE_ID>;
}

export type F274ZkSoundnessCheatDetectionMonitorTelemetrySnapshot = BaseFeatureTelemetry<typeof F274_FEATURE_ID>;

export const DEFAULT_F274_CONFIG: F274ZkSoundnessCheatDetectionMonitorConfig = {
  featureId: F274_FEATURE_ID,
  stage: F274_STAGE,
  operationCode: F274_OPERATION_CODE,
  contractVersion: F274_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F274ZkSoundnessCheatDetectionMonitorValidationError extends Error {
  public readonly featureId = F274_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F274 Validation Error on '${field}']: ${message}`);
    this.name = "F274ZkSoundnessCheatDetectionMonitorValidationError";
    this.field = field;
  }
}

export function computeF274Digest(rawPayload: string): string {
  return `f274_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F274ZkSoundnessCheatDetectionMonitorService extends KosmoraFeatureAdapterBase<
  typeof F274_FEATURE_ID,
  typeof F274_STAGE,
  typeof F274_OPERATION_CODE,
  F274ZkSoundnessCheatDetectionMonitorConfig,
  F274ZkSoundnessCheatDetectionMonitorInput,
  F274ZkSoundnessCheatDetectionMonitorOutput
> {
  constructor(customConfig?: Partial<F274ZkSoundnessCheatDetectionMonitorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F274_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["proof_transcript_id", "lhs_verification_hex", "rhs_expected_hex", "penalty_action"] as const,
      F274ZkSoundnessCheatDetectionMonitorValidationError
    );
  }
}

export function verifyF274Module(): {
  readonly featureId: typeof F274_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F274ZkSoundnessCheatDetectionMonitorService();
  const sampleInput: F274ZkSoundnessCheatDetectionMonitorInput = {
    requestId: "req_verify_f274",
    projectId: "proj_kosmora_f274",
    workspaceId: "ws_kosmora_f274",
    tenantId: "tenant_rlm_f274",
    actorId: "actor_verifier_f274",
    autonomyLevel: "A3",
    proof_transcript_id: "seed_f274_proof_transcript_id",
    lhs_verification_hex: 42,
    rhs_expected_hex: true,
    penalty_action: "seed_f274_penalty_action",
    metadata: { stage: "stage9-quantum-zk", featureId: "F274" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F274" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_proof_transcript_id !== sampleInput.proof_transcript_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F274] Verification failed`);
  }

  return {
    featureId: F274_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
