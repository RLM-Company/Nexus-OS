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

export const F471_FEATURE_ID = "F471" as const;
export const F471_STAGE = "stage15-topological-persistence" as const;
export const F471_OPERATION_CODE = "F471_BONNET_MYERS_DIAMETER_CURVATURE_BOUND_CHECKER" as const;
export const F471_CONTRACT_VERSION = "2.0.0" as const;

export type F471BonnetMyersDiameterCurvatureBoundCheckerConfig = BaseFeatureConfig<
  typeof F471_FEATURE_ID,
  typeof F471_STAGE,
  typeof F471_OPERATION_CODE
>;

export interface F471BonnetMyersDiameterCurvatureBoundCheckerInput extends BaseFeatureInput {
  readonly min_positive_ricci_kappa: string | number | boolean | readonly string[];
  readonly observed_graph_diameter: string | number | boolean | readonly string[];
  readonly theoretical_diameter_cap: string | number | boolean | readonly string[];
  readonly bound_satisfied: string | number | boolean | readonly string[];
}

export interface F471BonnetMyersDiameterCurvatureBoundCheckerOutput {
  readonly featureId: typeof F471_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F471_OPERATION_CODE;
  readonly resolved_min_positive_ricci_kappa: unknown;
  readonly resolved_observed_graph_diameter: unknown;
  readonly resolved_theoretical_diameter_cap: unknown;
  readonly resolved_bound_satisfied: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F471_FEATURE_ID>;
}

export type F471BonnetMyersDiameterCurvatureBoundCheckerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F471_FEATURE_ID
>;

export const DEFAULT_F471_CONFIG: F471BonnetMyersDiameterCurvatureBoundCheckerConfig = {
  featureId: F471_FEATURE_ID,
  stage: F471_STAGE,
  operationCode: F471_OPERATION_CODE,
  contractVersion: F471_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F471BonnetMyersDiameterCurvatureBoundCheckerValidationError extends Error {
  public readonly featureId = F471_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F471 Validation Error on '${field}']: ${message}`);
    this.name = "F471BonnetMyersDiameterCurvatureBoundCheckerValidationError";
    this.field = field;
  }
}

export function computeF471Digest(rawPayload: string): string {
  return `f471_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F471BonnetMyersDiameterCurvatureBoundCheckerService extends KosmoraFeatureAdapterBase<
  typeof F471_FEATURE_ID,
  typeof F471_STAGE,
  typeof F471_OPERATION_CODE,
  F471BonnetMyersDiameterCurvatureBoundCheckerConfig,
  F471BonnetMyersDiameterCurvatureBoundCheckerInput,
  F471BonnetMyersDiameterCurvatureBoundCheckerOutput
> {
  constructor(
    customConfig?: Partial<F471BonnetMyersDiameterCurvatureBoundCheckerConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F471_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "min_positive_ricci_kappa",
        "observed_graph_diameter",
        "theoretical_diameter_cap",
        "bound_satisfied"
      ] as const,
      F471BonnetMyersDiameterCurvatureBoundCheckerValidationError
    );
  }
}

export function verifyF471Module(): {
  readonly featureId: typeof F471_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F471BonnetMyersDiameterCurvatureBoundCheckerService();
  const sampleInput: F471BonnetMyersDiameterCurvatureBoundCheckerInput = {
    requestId: "req_verify_f471",
    projectId: "proj_kosmora_f471",
    workspaceId: "ws_kosmora_f471",
    tenantId: "tenant_rlm_f471",
    actorId: "actor_verifier_f471",
    autonomyLevel: "A3",
    min_positive_ricci_kappa: "seed_f471_min_positive_ricci_kappa",
    observed_graph_diameter: 42,
    theoretical_diameter_cap: true,
    bound_satisfied: "seed_f471_bound_satisfied",
    metadata: { stage: "stage15-topological-persistence", featureId: "F471" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F471" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_min_positive_ricci_kappa !== sampleInput.min_positive_ricci_kappa &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F471] Verification failed`);
  }

  return {
    featureId: F471_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
