import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage15TopologicalPersistenceKernel } from "./stage-kernel.js";

export const F458_FEATURE_ID = "F458" as const;
export const F458_STAGE = "stage15-topological-persistence" as const;
export const F458_OPERATION_CODE = "F458_ELDER_RULE_UNION_FIND_PERSISTENCE_TRACKER" as const;
export const F458_CONTRACT_VERSION = "2.0.0" as const;

export type F458ElderRuleUnionFindPersistenceTrackerConfig = BaseFeatureConfig<
  typeof F458_FEATURE_ID,
  typeof F458_STAGE,
  typeof F458_OPERATION_CODE
>;

export interface F458ElderRuleUnionFindPersistenceTrackerInput extends BaseFeatureInput {
  readonly vertex_birth_times: string | number | boolean | readonly string[];
  readonly sorted_edge_weights: string | number | boolean | readonly string[];
  readonly component_mergers: string | number | boolean | readonly string[];
  readonly immortal_classes: string | number | boolean | readonly string[];
}

export interface F458ElderRuleUnionFindPersistenceTrackerOutput {
  readonly featureId: typeof F458_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F458_OPERATION_CODE;
  readonly resolved_vertex_birth_times: unknown;
  readonly resolved_sorted_edge_weights: unknown;
  readonly resolved_component_mergers: unknown;
  readonly resolved_immortal_classes: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F458_FEATURE_ID>;
}

export type F458ElderRuleUnionFindPersistenceTrackerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F458_FEATURE_ID
>;

export const DEFAULT_F458_CONFIG: F458ElderRuleUnionFindPersistenceTrackerConfig = {
  featureId: F458_FEATURE_ID,
  stage: F458_STAGE,
  operationCode: F458_OPERATION_CODE,
  contractVersion: F458_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F458ElderRuleUnionFindPersistenceTrackerValidationError extends Error {
  public readonly featureId = F458_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F458 Validation Error on '${field}']: ${message}`);
    this.name = "F458ElderRuleUnionFindPersistenceTrackerValidationError";
    this.field = field;
  }
}

export function computeF458Digest(rawPayload: string): string {
  return `f458_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F458ElderRuleUnionFindPersistenceTrackerService extends KosmoraFeatureAdapterBase<
  typeof F458_FEATURE_ID,
  typeof F458_STAGE,
  typeof F458_OPERATION_CODE,
  F458ElderRuleUnionFindPersistenceTrackerConfig,
  F458ElderRuleUnionFindPersistenceTrackerInput,
  F458ElderRuleUnionFindPersistenceTrackerOutput
> {
  constructor(
    customConfig?: Partial<F458ElderRuleUnionFindPersistenceTrackerConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F458_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "vertex_birth_times",
        "sorted_edge_weights",
        "component_mergers",
        "immortal_classes"
      ] as const,
      F458ElderRuleUnionFindPersistenceTrackerValidationError
    );
  }
}

export function verifyF458Module(): {
  readonly featureId: typeof F458_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F458ElderRuleUnionFindPersistenceTrackerService();
  const sampleInput: F458ElderRuleUnionFindPersistenceTrackerInput = {
    requestId: "req_verify_f458",
    projectId: "proj_kosmora_f458",
    workspaceId: "ws_kosmora_f458",
    tenantId: "tenant_rlm_f458",
    actorId: "actor_verifier_f458",
    autonomyLevel: "A3",
    vertex_birth_times: "seed_f458_vertex_birth_times",
    sorted_edge_weights: 42,
    component_mergers: true,
    immortal_classes: "seed_f458_immortal_classes",
    metadata: { stage: "stage15-topological-persistence", featureId: "F458" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F458" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_vertex_birth_times !== sampleInput.vertex_birth_times &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F458] Verification failed`);
  }

  return {
    featureId: F458_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
