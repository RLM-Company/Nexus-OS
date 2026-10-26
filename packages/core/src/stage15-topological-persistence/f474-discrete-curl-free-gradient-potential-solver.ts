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

export const F474_FEATURE_ID = "F474" as const;
export const F474_STAGE = "stage15-topological-persistence" as const;
export const F474_OPERATION_CODE = "F474_DISCRETE_CURL_FREE_GRADIENT_POTENTIAL_SOLVER" as const;
export const F474_CONTRACT_VERSION = "2.0.0" as const;

export type F474DiscreteCurlFreeGradientPotentialSolverConfig = BaseFeatureConfig<
  typeof F474_FEATURE_ID,
  typeof F474_STAGE,
  typeof F474_OPERATION_CODE
>;

export interface F474DiscreteCurlFreeGradientPotentialSolverInput extends BaseFeatureInput {
  readonly edge_preferences: string | number | boolean | readonly string[];
  readonly graph_laplacian_l0: string | number | boolean | readonly string[];
  readonly node_potentials_phi: string | number | boolean | readonly string[];
  readonly gradient_projection: string | number | boolean | readonly string[];
}

export interface F474DiscreteCurlFreeGradientPotentialSolverOutput {
  readonly featureId: typeof F474_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F474_OPERATION_CODE;
  readonly resolved_edge_preferences: unknown;
  readonly resolved_graph_laplacian_l0: unknown;
  readonly resolved_node_potentials_phi: unknown;
  readonly resolved_gradient_projection: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F474_FEATURE_ID>;
}

export type F474DiscreteCurlFreeGradientPotentialSolverTelemetrySnapshot = BaseFeatureTelemetry<typeof F474_FEATURE_ID>;

export const DEFAULT_F474_CONFIG: F474DiscreteCurlFreeGradientPotentialSolverConfig = {
  featureId: F474_FEATURE_ID,
  stage: F474_STAGE,
  operationCode: F474_OPERATION_CODE,
  contractVersion: F474_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F474DiscreteCurlFreeGradientPotentialSolverValidationError extends Error {
  public readonly featureId = F474_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F474 Validation Error on '${field}']: ${message}`);
    this.name = "F474DiscreteCurlFreeGradientPotentialSolverValidationError";
    this.field = field;
  }
}

export function computeF474Digest(rawPayload: string): string {
  return `f474_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F474DiscreteCurlFreeGradientPotentialSolverService extends KosmoraFeatureAdapterBase<
  typeof F474_FEATURE_ID,
  typeof F474_STAGE,
  typeof F474_OPERATION_CODE,
  F474DiscreteCurlFreeGradientPotentialSolverConfig,
  F474DiscreteCurlFreeGradientPotentialSolverInput,
  F474DiscreteCurlFreeGradientPotentialSolverOutput
> {
  constructor(customConfig?: Partial<F474DiscreteCurlFreeGradientPotentialSolverConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F474_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["edge_preferences", "graph_laplacian_l0", "node_potentials_phi", "gradient_projection"] as const,
      F474DiscreteCurlFreeGradientPotentialSolverValidationError
    );
  }
}

export function verifyF474Module(): {
  readonly featureId: typeof F474_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F474DiscreteCurlFreeGradientPotentialSolverService();
  const sampleInput: F474DiscreteCurlFreeGradientPotentialSolverInput = {
    requestId: "req_verify_f474",
    projectId: "proj_kosmora_f474",
    workspaceId: "ws_kosmora_f474",
    tenantId: "tenant_rlm_f474",
    actorId: "actor_verifier_f474",
    autonomyLevel: "A3",
    edge_preferences: "seed_f474_edge_preferences",
    graph_laplacian_l0: 42,
    node_potentials_phi: true,
    gradient_projection: "seed_f474_gradient_projection",
    metadata: { stage: "stage15-topological-persistence", featureId: "F474" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F474" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_edge_preferences !== sampleInput.edge_preferences &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F474] Verification failed`);
  }

  return {
    featureId: F474_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
