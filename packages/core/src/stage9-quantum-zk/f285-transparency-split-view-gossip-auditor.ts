/**
 * F285 (stage9-quantum-zk): Аудитор защиты от раздвоения журнала (Split-View Gossip Detector)
 * Сравнение вершин дерева между узлами кластера для исключения подмены истории
 * Operation Code: transparency_gossip_audit
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

export const F285_FEATURE_ID = "F285" as const;
export const F285_STAGE = "stage9-quantum-zk" as const;
export const F285_OPERATION_CODE = "transparency_gossip_audit" as const;
export const F285_CONTRACT_VERSION = "2.0.0" as const;

export type F285TransparencySplitViewGossipAuditorConfig = BaseFeatureConfig<
  typeof F285_FEATURE_ID,
  typeof F285_STAGE,
  typeof F285_OPERATION_CODE
>;

export interface F285TransparencySplitViewGossipAuditorInput extends BaseFeatureInput {
  readonly local_tree_head: string | number | boolean | readonly string[];
  readonly remote_tree_head: string | number | boolean | readonly string[];
  readonly tree_size: string | number | boolean | readonly string[];
  readonly conflict_action: string | number | boolean | readonly string[];
}

export interface F285TransparencySplitViewGossipAuditorOutput {
  readonly featureId: typeof F285_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F285_OPERATION_CODE;
  readonly resolved_local_tree_head: unknown;
  readonly resolved_remote_tree_head: unknown;
  readonly resolved_tree_size: unknown;
  readonly resolved_conflict_action: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F285_FEATURE_ID>;
}

export type F285TransparencySplitViewGossipAuditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F285_FEATURE_ID>;

export const DEFAULT_F285_CONFIG: F285TransparencySplitViewGossipAuditorConfig = {
  featureId: F285_FEATURE_ID,
  stage: F285_STAGE,
  operationCode: F285_OPERATION_CODE,
  contractVersion: F285_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F285TransparencySplitViewGossipAuditorValidationError extends Error {
  public readonly featureId = F285_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F285 Validation Error on '${field}']: ${message}`);
    this.name = "F285TransparencySplitViewGossipAuditorValidationError";
    this.field = field;
  }
}

export function computeF285Digest(rawPayload: string): string {
  return `f285_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F285TransparencySplitViewGossipAuditorService extends KosmoraFeatureAdapterBase<
  typeof F285_FEATURE_ID,
  typeof F285_STAGE,
  typeof F285_OPERATION_CODE,
  F285TransparencySplitViewGossipAuditorConfig,
  F285TransparencySplitViewGossipAuditorInput,
  F285TransparencySplitViewGossipAuditorOutput
> {
  constructor(customConfig?: Partial<F285TransparencySplitViewGossipAuditorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F285_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["local_tree_head", "remote_tree_head", "tree_size", "conflict_action"] as const,
      F285TransparencySplitViewGossipAuditorValidationError
    );
  }
}

export function verifyF285Module(): {
  readonly featureId: typeof F285_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F285TransparencySplitViewGossipAuditorService();
  const sampleInput: F285TransparencySplitViewGossipAuditorInput = {
    requestId: "req_verify_f285",
    projectId: "proj_kosmora_f285",
    workspaceId: "ws_kosmora_f285",
    tenantId: "tenant_rlm_f285",
    actorId: "actor_verifier_f285",
    autonomyLevel: "A3",
    local_tree_head: "seed_f285_local_tree_head",
    remote_tree_head: 42,
    tree_size: true,
    conflict_action: "seed_f285_conflict_action",
    metadata: { stage: "stage9-quantum-zk", featureId: "F285" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F285" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_local_tree_head !== sampleInput.local_tree_head &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F285] Verification failed`);
  }

  return {
    featureId: F285_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
