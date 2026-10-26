import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage13NeurosymbolicSatKernel } from "./stage-kernel.js";

export const F400_FEATURE_ID = "F400" as const;
export const F400_STAGE = "stage13-neurosymbolic-sat" as const;
export const F400_OPERATION_CODE = "F400_KNOWLEDGE_GRAPH_CONJUNCTIVE_QUERY_PLANNER" as const;
export const F400_CONTRACT_VERSION = "2.0.0" as const;

export type F400KnowledgeGraphConjunctiveQueryPlannerConfig = BaseFeatureConfig<
  typeof F400_FEATURE_ID,
  typeof F400_STAGE,
  typeof F400_OPERATION_CODE
>;

export interface F400KnowledgeGraphConjunctiveQueryPlannerInput extends BaseFeatureInput {
  readonly conjunctive_atoms: string | number | boolean | readonly string[];
  readonly relation_cardinalities: string | number | boolean | readonly string[];
  readonly join_ordering_policy: string | number | boolean | readonly string[];
  readonly projection_vars: string | number | boolean | readonly string[];
}

export interface F400KnowledgeGraphConjunctiveQueryPlannerOutput {
  readonly featureId: typeof F400_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F400_OPERATION_CODE;
  readonly resolved_conjunctive_atoms: unknown;
  readonly resolved_relation_cardinalities: unknown;
  readonly resolved_join_ordering_policy: unknown;
  readonly resolved_projection_vars: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F400_FEATURE_ID>;
}

export type F400KnowledgeGraphConjunctiveQueryPlannerTelemetrySnapshot = BaseFeatureTelemetry<typeof F400_FEATURE_ID>;

export const DEFAULT_F400_CONFIG: F400KnowledgeGraphConjunctiveQueryPlannerConfig = {
  featureId: F400_FEATURE_ID,
  stage: F400_STAGE,
  operationCode: F400_OPERATION_CODE,
  contractVersion: F400_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F400KnowledgeGraphConjunctiveQueryPlannerValidationError extends Error {
  public readonly featureId = F400_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F400 Validation Error on '${field}']: ${message}`);
    this.name = "F400KnowledgeGraphConjunctiveQueryPlannerValidationError";
    this.field = field;
  }
}

export function computeF400Digest(rawPayload: string): string {
  return `f400_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F400KnowledgeGraphConjunctiveQueryPlannerService extends KosmoraFeatureAdapterBase<
  typeof F400_FEATURE_ID,
  typeof F400_STAGE,
  typeof F400_OPERATION_CODE,
  F400KnowledgeGraphConjunctiveQueryPlannerConfig,
  F400KnowledgeGraphConjunctiveQueryPlannerInput,
  F400KnowledgeGraphConjunctiveQueryPlannerOutput
> {
  constructor(customConfig?: Partial<F400KnowledgeGraphConjunctiveQueryPlannerConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F400_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["conjunctive_atoms", "relation_cardinalities", "join_ordering_policy", "projection_vars"] as const,
      F400KnowledgeGraphConjunctiveQueryPlannerValidationError
    );
  }
}

export function verifyF400Module(): {
  readonly featureId: typeof F400_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F400KnowledgeGraphConjunctiveQueryPlannerService();
  const sampleInput: F400KnowledgeGraphConjunctiveQueryPlannerInput = {
    requestId: "req_verify_f400",
    projectId: "proj_kosmora_f400",
    workspaceId: "ws_kosmora_f400",
    tenantId: "tenant_rlm_f400",
    actorId: "actor_verifier_f400",
    autonomyLevel: "A3",
    conjunctive_atoms: "seed_f400_conjunctive_atoms",
    relation_cardinalities: 42,
    join_ordering_policy: true,
    projection_vars: "seed_f400_projection_vars",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F400" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F400" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_conjunctive_atoms !== sampleInput.conjunctive_atoms &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F400] Verification failed`);
  }

  return {
    featureId: F400_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
