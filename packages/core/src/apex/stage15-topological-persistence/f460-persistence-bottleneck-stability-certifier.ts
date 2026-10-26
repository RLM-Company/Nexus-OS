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

export const F460_FEATURE_ID = "F460" as const;
export const F460_STAGE = "stage15-topological-persistence" as const;
export const F460_OPERATION_CODE = "F460_PERSISTENCE_BOTTLENECK_STABILITY_CERTIFIER" as const;
export const F460_CONTRACT_VERSION = "2.0.0" as const;

export type F460PersistenceBottleneckStabilityCertifierConfig = BaseFeatureConfig<
  typeof F460_FEATURE_ID,
  typeof F460_STAGE,
  typeof F460_OPERATION_CODE
>;

export interface F460PersistenceBottleneckStabilityCertifierInput extends BaseFeatureInput {
  readonly baseline_barcode: string | number | boolean | readonly string[];
  readonly perturbed_barcode: string | number | boolean | readonly string[];
  readonly hausdorff_perturbation: string | number | boolean | readonly string[];
  readonly linf_bottleneck_dist: string | number | boolean | readonly string[];
}

export interface F460PersistenceBottleneckStabilityCertifierOutput {
  readonly featureId: typeof F460_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F460_OPERATION_CODE;
  readonly resolved_baseline_barcode: unknown;
  readonly resolved_perturbed_barcode: unknown;
  readonly resolved_hausdorff_perturbation: unknown;
  readonly resolved_linf_bottleneck_dist: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F460_FEATURE_ID>;
}

export type F460PersistenceBottleneckStabilityCertifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F460_FEATURE_ID
>;

export const DEFAULT_F460_CONFIG: F460PersistenceBottleneckStabilityCertifierConfig = {
  featureId: F460_FEATURE_ID,
  stage: F460_STAGE,
  operationCode: F460_OPERATION_CODE,
  contractVersion: F460_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F460PersistenceBottleneckStabilityCertifierValidationError extends Error {
  public readonly featureId = F460_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F460 Validation Error on '${field}']: ${message}`);
    this.name = "F460PersistenceBottleneckStabilityCertifierValidationError";
    this.field = field;
  }
}

export function computeF460Digest(rawPayload: string): string {
  return `f460_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F460PersistenceBottleneckStabilityCertifierService extends KosmoraFeatureAdapterBase<
  typeof F460_FEATURE_ID,
  typeof F460_STAGE,
  typeof F460_OPERATION_CODE,
  F460PersistenceBottleneckStabilityCertifierConfig,
  F460PersistenceBottleneckStabilityCertifierInput,
  F460PersistenceBottleneckStabilityCertifierOutput
> {
  constructor(
    customConfig?: Partial<F460PersistenceBottleneckStabilityCertifierConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F460_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "baseline_barcode",
        "perturbed_barcode",
        "hausdorff_perturbation",
        "linf_bottleneck_dist"
      ] as const,
      F460PersistenceBottleneckStabilityCertifierValidationError
    );
  }
}

export function verifyF460Module(): {
  readonly featureId: typeof F460_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F460PersistenceBottleneckStabilityCertifierService();
  const sampleInput: F460PersistenceBottleneckStabilityCertifierInput = {
    requestId: "req_verify_f460",
    projectId: "proj_kosmora_f460",
    workspaceId: "ws_kosmora_f460",
    tenantId: "tenant_rlm_f460",
    actorId: "actor_verifier_f460",
    autonomyLevel: "A3",
    baseline_barcode: "seed_f460_baseline_barcode",
    perturbed_barcode: 42,
    hausdorff_perturbation: true,
    linf_bottleneck_dist: "seed_f460_linf_bottleneck_dist",
    metadata: { stage: "stage15-topological-persistence", featureId: "F460" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F460" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_baseline_barcode !== sampleInput.baseline_barcode &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F460] Verification failed`);
  }

  return {
    featureId: F460_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
