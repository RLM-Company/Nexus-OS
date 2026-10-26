/**
 * F283 (stage9-quantum-zk): Построитель маршрутов доказательства включения (Merkle Audit Path)
 * Вычисление логарифмического пути соседей от целевого листа до корня дерева прозрачности
 * Operation Code: transparency_inclusion_gen
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

export const F283_FEATURE_ID = "F283" as const;
export const F283_STAGE = "stage9-quantum-zk" as const;
export const F283_OPERATION_CODE = "transparency_inclusion_gen" as const;
export const F283_CONTRACT_VERSION = "2.0.0" as const;

export type F283TransparencyInclusionProofPathGeneratorConfig = BaseFeatureConfig<
  typeof F283_FEATURE_ID,
  typeof F283_STAGE,
  typeof F283_OPERATION_CODE
>;

export interface F283TransparencyInclusionProofPathGeneratorInput extends BaseFeatureInput {
  readonly leaf_sequence: string | number | boolean | readonly string[];
  readonly leaf_payload_hash: string | number | boolean | readonly string[];
  readonly snapshot_tree_size: string | number | boolean | readonly string[];
  readonly audit_requester: string | number | boolean | readonly string[];
}

export interface F283TransparencyInclusionProofPathGeneratorOutput {
  readonly featureId: typeof F283_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F283_OPERATION_CODE;
  readonly resolved_leaf_sequence: unknown;
  readonly resolved_leaf_payload_hash: unknown;
  readonly resolved_snapshot_tree_size: unknown;
  readonly resolved_audit_requester: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F283_FEATURE_ID>;
}

export type F283TransparencyInclusionProofPathGeneratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F283_FEATURE_ID
>;

export const DEFAULT_F283_CONFIG: F283TransparencyInclusionProofPathGeneratorConfig = {
  featureId: F283_FEATURE_ID,
  stage: F283_STAGE,
  operationCode: F283_OPERATION_CODE,
  contractVersion: F283_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F283TransparencyInclusionProofPathGeneratorValidationError extends Error {
  public readonly featureId = F283_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F283 Validation Error on '${field}']: ${message}`);
    this.name = "F283TransparencyInclusionProofPathGeneratorValidationError";
    this.field = field;
  }
}

export function computeF283Digest(rawPayload: string): string {
  return `f283_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F283TransparencyInclusionProofPathGeneratorService extends KosmoraFeatureAdapterBase<
  typeof F283_FEATURE_ID,
  typeof F283_STAGE,
  typeof F283_OPERATION_CODE,
  F283TransparencyInclusionProofPathGeneratorConfig,
  F283TransparencyInclusionProofPathGeneratorInput,
  F283TransparencyInclusionProofPathGeneratorOutput
> {
  constructor(
    customConfig?: Partial<F283TransparencyInclusionProofPathGeneratorConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F283_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["leaf_sequence", "leaf_payload_hash", "snapshot_tree_size", "audit_requester"] as const,
      F283TransparencyInclusionProofPathGeneratorValidationError
    );
  }
}

export function verifyF283Module(): {
  readonly featureId: typeof F283_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F283TransparencyInclusionProofPathGeneratorService();
  const sampleInput: F283TransparencyInclusionProofPathGeneratorInput = {
    requestId: "req_verify_f283",
    projectId: "proj_kosmora_f283",
    workspaceId: "ws_kosmora_f283",
    tenantId: "tenant_rlm_f283",
    actorId: "actor_verifier_f283",
    autonomyLevel: "A3",
    leaf_sequence: "seed_f283_leaf_sequence",
    leaf_payload_hash: 42,
    snapshot_tree_size: true,
    audit_requester: "seed_f283_audit_requester",
    metadata: { stage: "stage9-quantum-zk", featureId: "F283" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F283" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_leaf_sequence !== sampleInput.leaf_sequence &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F283] Verification failed`);
  }

  return {
    featureId: F283_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
