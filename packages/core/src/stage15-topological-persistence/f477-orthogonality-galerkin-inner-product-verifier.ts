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

export const F477_FEATURE_ID = "F477" as const;
export const F477_STAGE = "stage15-topological-persistence" as const;
export const F477_OPERATION_CODE = "F477_ORTHOGONALITY_GALERKIN_INNER_PRODUCT_VERIFIER" as const;
export const F477_CONTRACT_VERSION = "2.0.0" as const;

export type F477OrthogonalityGalerkinInnerProductVerifierConfig = BaseFeatureConfig<
  typeof F477_FEATURE_ID,
  typeof F477_STAGE,
  typeof F477_OPERATION_CODE
>;

export interface F477OrthogonalityGalerkinInnerProductVerifierInput extends BaseFeatureInput {
  readonly gradient_vector: string | number | boolean | readonly string[];
  readonly harmonic_vector: string | number | boolean | readonly string[];
  readonly l2_inner_product: string | number | boolean | readonly string[];
  readonly pythagorean_energy_ok: string | number | boolean | readonly string[];
}

export interface F477OrthogonalityGalerkinInnerProductVerifierOutput {
  readonly featureId: typeof F477_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F477_OPERATION_CODE;
  readonly resolved_gradient_vector: unknown;
  readonly resolved_harmonic_vector: unknown;
  readonly resolved_l2_inner_product: unknown;
  readonly resolved_pythagorean_energy_ok: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F477_FEATURE_ID>;
}

export type F477OrthogonalityGalerkinInnerProductVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F477_FEATURE_ID>;

export const DEFAULT_F477_CONFIG: F477OrthogonalityGalerkinInnerProductVerifierConfig = {
  featureId: F477_FEATURE_ID,
  stage: F477_STAGE,
  operationCode: F477_OPERATION_CODE,
  contractVersion: F477_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F477OrthogonalityGalerkinInnerProductVerifierValidationError extends Error {
  public readonly featureId = F477_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F477 Validation Error on '${field}']: ${message}`);
    this.name = "F477OrthogonalityGalerkinInnerProductVerifierValidationError";
    this.field = field;
  }
}

export function computeF477Digest(rawPayload: string): string {
  return `f477_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F477OrthogonalityGalerkinInnerProductVerifierService extends KosmoraFeatureAdapterBase<
  typeof F477_FEATURE_ID,
  typeof F477_STAGE,
  typeof F477_OPERATION_CODE,
  F477OrthogonalityGalerkinInnerProductVerifierConfig,
  F477OrthogonalityGalerkinInnerProductVerifierInput,
  F477OrthogonalityGalerkinInnerProductVerifierOutput
> {
  constructor(customConfig?: Partial<F477OrthogonalityGalerkinInnerProductVerifierConfig>, kernel?: Stage15TopologicalPersistenceKernel) {
    super(
      DEFAULT_F477_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["gradient_vector", "harmonic_vector", "l2_inner_product", "pythagorean_energy_ok"] as const,
      F477OrthogonalityGalerkinInnerProductVerifierValidationError
    );
  }
}

export function verifyF477Module(): {
  readonly featureId: typeof F477_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F477OrthogonalityGalerkinInnerProductVerifierService();
  const sampleInput: F477OrthogonalityGalerkinInnerProductVerifierInput = {
    requestId: "req_verify_f477",
    projectId: "proj_kosmora_f477",
    workspaceId: "ws_kosmora_f477",
    tenantId: "tenant_rlm_f477",
    actorId: "actor_verifier_f477",
    autonomyLevel: "A3",
    gradient_vector: "seed_f477_gradient_vector",
    harmonic_vector: 42,
    l2_inner_product: true,
    pythagorean_energy_ok: "seed_f477_pythagorean_energy_ok",
    metadata: { stage: "stage15-topological-persistence", featureId: "F477" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F477" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_gradient_vector !== sampleInput.gradient_vector &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F477] Verification failed`);
  }

  return {
    featureId: F477_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
