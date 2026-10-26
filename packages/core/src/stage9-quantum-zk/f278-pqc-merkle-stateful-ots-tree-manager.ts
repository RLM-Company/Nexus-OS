/**
 * F278 (stage9-quantum-zk): Менеджер дерева Меркла для многоразовых постквантовых подписей (Stateful HBS)
 * Объединение одноразовых ключей OTS в единое дерево с проверкой индекса использованного листа
 * Operation Code: pqc_merkle_ots_tree
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

export const F278_FEATURE_ID = "F278" as const;
export const F278_STAGE = "stage9-quantum-zk" as const;
export const F278_OPERATION_CODE = "pqc_merkle_ots_tree" as const;
export const F278_CONTRACT_VERSION = "2.0.0" as const;

export type F278PqcMerkleStatefulOtsTreeManagerConfig = BaseFeatureConfig<
  typeof F278_FEATURE_ID,
  typeof F278_STAGE,
  typeof F278_OPERATION_CODE
>;

export interface F278PqcMerkleStatefulOtsTreeManagerInput extends BaseFeatureInput {
  readonly tree_id: string | number | boolean | readonly string[];
  readonly leaf_index: string | number | boolean | readonly string[];
  readonly max_one_time_keys: string | number | boolean | readonly string[];
  readonly root_anchor_hex: string | number | boolean | readonly string[];
}

export interface F278PqcMerkleStatefulOtsTreeManagerOutput {
  readonly featureId: typeof F278_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F278_OPERATION_CODE;
  readonly resolved_tree_id: unknown;
  readonly resolved_leaf_index: unknown;
  readonly resolved_max_one_time_keys: unknown;
  readonly resolved_root_anchor_hex: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F278_FEATURE_ID>;
}

export type F278PqcMerkleStatefulOtsTreeManagerTelemetrySnapshot = BaseFeatureTelemetry<typeof F278_FEATURE_ID>;

export const DEFAULT_F278_CONFIG: F278PqcMerkleStatefulOtsTreeManagerConfig = {
  featureId: F278_FEATURE_ID,
  stage: F278_STAGE,
  operationCode: F278_OPERATION_CODE,
  contractVersion: F278_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F278PqcMerkleStatefulOtsTreeManagerValidationError extends Error {
  public readonly featureId = F278_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F278 Validation Error on '${field}']: ${message}`);
    this.name = "F278PqcMerkleStatefulOtsTreeManagerValidationError";
    this.field = field;
  }
}

export function computeF278Digest(rawPayload: string): string {
  return `f278_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F278PqcMerkleStatefulOtsTreeManagerService extends KosmoraFeatureAdapterBase<
  typeof F278_FEATURE_ID,
  typeof F278_STAGE,
  typeof F278_OPERATION_CODE,
  F278PqcMerkleStatefulOtsTreeManagerConfig,
  F278PqcMerkleStatefulOtsTreeManagerInput,
  F278PqcMerkleStatefulOtsTreeManagerOutput
> {
  constructor(customConfig?: Partial<F278PqcMerkleStatefulOtsTreeManagerConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F278_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["tree_id", "leaf_index", "max_one_time_keys", "root_anchor_hex"] as const,
      F278PqcMerkleStatefulOtsTreeManagerValidationError
    );
  }
}

export function verifyF278Module(): {
  readonly featureId: typeof F278_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F278PqcMerkleStatefulOtsTreeManagerService();
  const sampleInput: F278PqcMerkleStatefulOtsTreeManagerInput = {
    requestId: "req_verify_f278",
    projectId: "proj_kosmora_f278",
    workspaceId: "ws_kosmora_f278",
    tenantId: "tenant_rlm_f278",
    actorId: "actor_verifier_f278",
    autonomyLevel: "A3",
    tree_id: "seed_f278_tree_id",
    leaf_index: 42,
    max_one_time_keys: true,
    root_anchor_hex: "seed_f278_root_anchor_hex",
    metadata: { stage: "stage9-quantum-zk", featureId: "F278" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F278" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tree_id !== sampleInput.tree_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F278] Verification failed`);
  }

  return {
    featureId: F278_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
