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

export const F451_FEATURE_ID = "F451" as const;
export const F451_STAGE = "stage15-topological-persistence" as const;
export const F451_OPERATION_CODE = "F451_TOPOLOGICAL_BETTI_NUMBER_HOMOLOGY_EXTRACTOR" as const;
export const F451_CONTRACT_VERSION = "2.0.0" as const;

export type F451TopologicalBettiNumberHomologyExtractorConfig = BaseFeatureConfig<
  typeof F451_FEATURE_ID,
  typeof F451_STAGE,
  typeof F451_OPERATION_CODE
>;

export interface F451TopologicalBettiNumberHomologyExtractorInput extends BaseFeatureInput {
  readonly simplicial_complex: string | number | boolean | readonly string[];
  readonly betti_0_target: string | number | boolean | readonly string[];
  readonly betti_1_target: string | number | boolean | readonly string[];
  readonly homology_coeff: string | number | boolean | readonly string[];
}

export interface F451TopologicalBettiNumberHomologyExtractorOutput {
  readonly featureId: typeof F451_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F451_OPERATION_CODE;
  readonly resolved_simplicial_complex: unknown;
  readonly resolved_betti_0_target: unknown;
  readonly resolved_betti_1_target: unknown;
  readonly resolved_homology_coeff: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F451_FEATURE_ID>;
}

export type F451TopologicalBettiNumberHomologyExtractorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F451_FEATURE_ID
>;

export const DEFAULT_F451_CONFIG: F451TopologicalBettiNumberHomologyExtractorConfig = {
  featureId: F451_FEATURE_ID,
  stage: F451_STAGE,
  operationCode: F451_OPERATION_CODE,
  contractVersion: F451_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F451TopologicalBettiNumberHomologyExtractorValidationError extends Error {
  public readonly featureId = F451_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F451 Validation Error on '${field}']: ${message}`);
    this.name = "F451TopologicalBettiNumberHomologyExtractorValidationError";
    this.field = field;
  }
}

export function computeF451Digest(rawPayload: string): string {
  return `f451_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F451TopologicalBettiNumberHomologyExtractorService extends KosmoraFeatureAdapterBase<
  typeof F451_FEATURE_ID,
  typeof F451_STAGE,
  typeof F451_OPERATION_CODE,
  F451TopologicalBettiNumberHomologyExtractorConfig,
  F451TopologicalBettiNumberHomologyExtractorInput,
  F451TopologicalBettiNumberHomologyExtractorOutput
> {
  constructor(
    customConfig?: Partial<F451TopologicalBettiNumberHomologyExtractorConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F451_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      ["simplicial_complex", "betti_0_target", "betti_1_target", "homology_coeff"] as const,
      F451TopologicalBettiNumberHomologyExtractorValidationError
    );
  }
}

export function verifyF451Module(): {
  readonly featureId: typeof F451_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F451TopologicalBettiNumberHomologyExtractorService();
  const sampleInput: F451TopologicalBettiNumberHomologyExtractorInput = {
    requestId: "req_verify_f451",
    projectId: "proj_kosmora_f451",
    workspaceId: "ws_kosmora_f451",
    tenantId: "tenant_rlm_f451",
    actorId: "actor_verifier_f451",
    autonomyLevel: "A3",
    simplicial_complex: "seed_f451_simplicial_complex",
    betti_0_target: 42,
    betti_1_target: true,
    homology_coeff: "seed_f451_homology_coeff",
    metadata: { stage: "stage15-topological-persistence", featureId: "F451" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F451" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_simplicial_complex !== sampleInput.simplicial_complex &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F451] Verification failed`);
  }

  return {
    featureId: F451_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
