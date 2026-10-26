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

export const F466_FEATURE_ID = "F466" as const;
export const F466_STAGE = "stage15-topological-persistence" as const;
export const F466_OPERATION_CODE = "F466_WASSERSTEIN_EARTH_MOVER_NEIGHBORHOOD_TRANSPORT" as const;
export const F466_CONTRACT_VERSION = "2.0.0" as const;

export type F466WassersteinEarthMoverNeighborhoodTransportConfig = BaseFeatureConfig<
  typeof F466_FEATURE_ID,
  typeof F466_STAGE,
  typeof F466_OPERATION_CODE
>;

export interface F466WassersteinEarthMoverNeighborhoodTransportInput extends BaseFeatureInput {
  readonly source_measure_mu: string | number | boolean | readonly string[];
  readonly target_measure_nu: string | number | boolean | readonly string[];
  readonly shortest_path_metric: string | number | boolean | readonly string[];
  readonly optimal_coupling: string | number | boolean | readonly string[];
}

export interface F466WassersteinEarthMoverNeighborhoodTransportOutput {
  readonly featureId: typeof F466_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F466_OPERATION_CODE;
  readonly resolved_source_measure_mu: unknown;
  readonly resolved_target_measure_nu: unknown;
  readonly resolved_shortest_path_metric: unknown;
  readonly resolved_optimal_coupling: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F466_FEATURE_ID>;
}

export type F466WassersteinEarthMoverNeighborhoodTransportTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F466_FEATURE_ID
>;

export const DEFAULT_F466_CONFIG: F466WassersteinEarthMoverNeighborhoodTransportConfig = {
  featureId: F466_FEATURE_ID,
  stage: F466_STAGE,
  operationCode: F466_OPERATION_CODE,
  contractVersion: F466_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F466WassersteinEarthMoverNeighborhoodTransportValidationError extends Error {
  public readonly featureId = F466_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F466 Validation Error on '${field}']: ${message}`);
    this.name = "F466WassersteinEarthMoverNeighborhoodTransportValidationError";
    this.field = field;
  }
}

export function computeF466Digest(rawPayload: string): string {
  return `f466_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F466WassersteinEarthMoverNeighborhoodTransportService extends KosmoraFeatureAdapterBase<
  typeof F466_FEATURE_ID,
  typeof F466_STAGE,
  typeof F466_OPERATION_CODE,
  F466WassersteinEarthMoverNeighborhoodTransportConfig,
  F466WassersteinEarthMoverNeighborhoodTransportInput,
  F466WassersteinEarthMoverNeighborhoodTransportOutput
> {
  constructor(
    customConfig?: Partial<F466WassersteinEarthMoverNeighborhoodTransportConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F466_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "source_measure_mu",
        "target_measure_nu",
        "shortest_path_metric",
        "optimal_coupling"
      ] as const,
      F466WassersteinEarthMoverNeighborhoodTransportValidationError
    );
  }
}

export function verifyF466Module(): {
  readonly featureId: typeof F466_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F466WassersteinEarthMoverNeighborhoodTransportService();
  const sampleInput: F466WassersteinEarthMoverNeighborhoodTransportInput = {
    requestId: "req_verify_f466",
    projectId: "proj_kosmora_f466",
    workspaceId: "ws_kosmora_f466",
    tenantId: "tenant_rlm_f466",
    actorId: "actor_verifier_f466",
    autonomyLevel: "A3",
    source_measure_mu: "seed_f466_source_measure_mu",
    target_measure_nu: 42,
    shortest_path_metric: true,
    optimal_coupling: "seed_f466_optimal_coupling",
    metadata: { stage: "stage15-topological-persistence", featureId: "F466" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F466" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_measure_mu !== sampleInput.source_measure_mu &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F466] Verification failed`);
  }

  return {
    featureId: F466_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
