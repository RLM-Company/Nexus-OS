/**
 * F286 (stage9-quantum-zk): Прувер монотонности расширения журнала (Append-Only Consistency)
 * Доказательство того, что новое состояние дерева является строгим надмножеством предыдущего
 * Operation Code: transparency_consistency_prove
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

export const F286_FEATURE_ID = "F286" as const;
export const F286_STAGE = "stage9-quantum-zk" as const;
export const F286_OPERATION_CODE = "transparency_consistency_prove" as const;
export const F286_CONTRACT_VERSION = "2.0.0" as const;

export type F286TransparencyAppendOnlyConsistencyProverConfig = BaseFeatureConfig<
  typeof F286_FEATURE_ID,
  typeof F286_STAGE,
  typeof F286_OPERATION_CODE
>;

export interface F286TransparencyAppendOnlyConsistencyProverInput extends BaseFeatureInput {
  readonly old_tree_size: string | number | boolean | readonly string[];
  readonly new_tree_size: string | number | boolean | readonly string[];
  readonly old_root_hash: string | number | boolean | readonly string[];
  readonly new_root_hash: string | number | boolean | readonly string[];
}

export interface F286TransparencyAppendOnlyConsistencyProverOutput {
  readonly featureId: typeof F286_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F286_OPERATION_CODE;
  readonly resolved_old_tree_size: unknown;
  readonly resolved_new_tree_size: unknown;
  readonly resolved_old_root_hash: unknown;
  readonly resolved_new_root_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F286_FEATURE_ID>;
}

export type F286TransparencyAppendOnlyConsistencyProverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F286_FEATURE_ID
>;

export const DEFAULT_F286_CONFIG: F286TransparencyAppendOnlyConsistencyProverConfig = {
  featureId: F286_FEATURE_ID,
  stage: F286_STAGE,
  operationCode: F286_OPERATION_CODE,
  contractVersion: F286_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F286TransparencyAppendOnlyConsistencyProverValidationError extends Error {
  public readonly featureId = F286_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F286 Validation Error on '${field}']: ${message}`);
    this.name = "F286TransparencyAppendOnlyConsistencyProverValidationError";
    this.field = field;
  }
}

export function computeF286Digest(rawPayload: string): string {
  return `f286_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F286TransparencyAppendOnlyConsistencyProverService extends KosmoraFeatureAdapterBase<
  typeof F286_FEATURE_ID,
  typeof F286_STAGE,
  typeof F286_OPERATION_CODE,
  F286TransparencyAppendOnlyConsistencyProverConfig,
  F286TransparencyAppendOnlyConsistencyProverInput,
  F286TransparencyAppendOnlyConsistencyProverOutput
> {
  constructor(
    customConfig?: Partial<F286TransparencyAppendOnlyConsistencyProverConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F286_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["old_tree_size", "new_tree_size", "old_root_hash", "new_root_hash"] as const,
      F286TransparencyAppendOnlyConsistencyProverValidationError
    );
  }
}

export function verifyF286Module(): {
  readonly featureId: typeof F286_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F286TransparencyAppendOnlyConsistencyProverService();
  const sampleInput: F286TransparencyAppendOnlyConsistencyProverInput = {
    requestId: "req_verify_f286",
    projectId: "proj_kosmora_f286",
    workspaceId: "ws_kosmora_f286",
    tenantId: "tenant_rlm_f286",
    actorId: "actor_verifier_f286",
    autonomyLevel: "A3",
    old_tree_size: "seed_f286_old_tree_size",
    new_tree_size: 42,
    old_root_hash: true,
    new_root_hash: "seed_f286_new_root_hash",
    metadata: { stage: "stage9-quantum-zk", featureId: "F286" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F286" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_old_tree_size !== sampleInput.old_tree_size &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F286] Verification failed`);
  }

  return {
    featureId: F286_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
