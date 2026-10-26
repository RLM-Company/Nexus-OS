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

export const F459_FEATURE_ID = "F459" as const;
export const F459_STAGE = "stage15-topological-persistence" as const;
export const F459_OPERATION_CODE = "F459_PERSISTENCE_DIAGRAM_WASSERSTEIN_DISTANCE_METRIC" as const;
export const F459_CONTRACT_VERSION = "2.0.0" as const;

export type F459PersistenceDiagramWassersteinDistanceMetricConfig = BaseFeatureConfig<
  typeof F459_FEATURE_ID,
  typeof F459_STAGE,
  typeof F459_OPERATION_CODE
>;

export interface F459PersistenceDiagramWassersteinDistanceMetricInput extends BaseFeatureInput {
  readonly diagram_alpha: string | number | boolean | readonly string[];
  readonly diagram_beta: string | number | boolean | readonly string[];
  readonly wasserstein_exponent_p: string | number | boolean | readonly string[];
  readonly diagonal_projections: string | number | boolean | readonly string[];
}

export interface F459PersistenceDiagramWassersteinDistanceMetricOutput {
  readonly featureId: typeof F459_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F459_OPERATION_CODE;
  readonly resolved_diagram_alpha: unknown;
  readonly resolved_diagram_beta: unknown;
  readonly resolved_wasserstein_exponent_p: unknown;
  readonly resolved_diagonal_projections: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F459_FEATURE_ID>;
}

export type F459PersistenceDiagramWassersteinDistanceMetricTelemetrySnapshot = BaseFeatureTelemetry<typeof F459_FEATURE_ID>;

export const DEFAULT_F459_CONFIG: F459PersistenceDiagramWassersteinDistanceMetricConfig = {
  featureId: F459_FEATURE_ID,
  stage: F459_STAGE,
  operationCode: F459_OPERATION_CODE,
  contractVersion: F459_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F459PersistenceDiagramWassersteinDistanceMetricValidationError extends Error {
  public readonly featureId = F459_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F459 Validation Error on '${field}']: ${message}`);
    this.name = "F459PersistenceDiagramWassersteinDistanceMetricValidationError";
    this.field = field;
  }
}

export function computeF459Digest(rawPayload: string): string {
  return `f459_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F459PersistenceDiagramWassersteinDistanceMetricService extends KosmoraFeatureAdapterBase<
  typeof F459_FEATURE_ID,
  typeof F459_STAGE,
  typeof F459_OPERATION_CODE,
  F459PersistenceDiagramWassersteinDistanceMetricConfig,
  F459PersistenceDiagramWassersteinDistanceMetricInput,
  F459PersistenceDiagramWassersteinDistanceMetricOutput
> {
  constructor(customConfig?: Partial<F459PersistenceDiagramWassersteinDistanceMetricConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F459_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["diagram_alpha", "diagram_beta", "wasserstein_exponent_p", "diagonal_projections"] as const,
      F459PersistenceDiagramWassersteinDistanceMetricValidationError
    );
  }
}

export function verifyF459Module(): {
  readonly featureId: typeof F459_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F459PersistenceDiagramWassersteinDistanceMetricService();
  const sampleInput: F459PersistenceDiagramWassersteinDistanceMetricInput = {
    requestId: "req_verify_f459",
    projectId: "proj_kosmora_f459",
    workspaceId: "ws_kosmora_f459",
    tenantId: "tenant_rlm_f459",
    actorId: "actor_verifier_f459",
    autonomyLevel: "A3",
    diagram_alpha: "seed_f459_diagram_alpha",
    diagram_beta: 42,
    wasserstein_exponent_p: true,
    diagonal_projections: "seed_f459_diagonal_projections",
    metadata: { stage: "stage15-topological-persistence", featureId: "F459" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F459" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_diagram_alpha !== sampleInput.diagram_alpha &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F459] Verification failed`);
  }

  return {
    featureId: F459_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
