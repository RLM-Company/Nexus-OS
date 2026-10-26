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

export const F463_FEATURE_ID = "F463" as const;
export const F463_STAGE = "stage15-topological-persistence" as const;
export const F463_OPERATION_CODE = "F463_TOPOLOGICAL_CYCLE_GENERATOR_LOOP_LOCALIZER" as const;
export const F463_CONTRACT_VERSION = "2.0.0" as const;

export type F463TopologicalCycleGeneratorLoopLocalizerConfig = BaseFeatureConfig<
  typeof F463_FEATURE_ID,
  typeof F463_STAGE,
  typeof F463_OPERATION_CODE
>;

export interface F463TopologicalCycleGeneratorLoopLocalizerInput extends BaseFeatureInput {
  readonly closing_edge: string | number | boolean | readonly string[];
  readonly spanning_tree_parents: string | number | boolean | readonly string[];
  readonly fundamental_cycle_nodes: string | number | boolean | readonly string[];
  readonly persistence_span: string | number | boolean | readonly string[];
}

export interface F463TopologicalCycleGeneratorLoopLocalizerOutput {
  readonly featureId: typeof F463_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F463_OPERATION_CODE;
  readonly resolved_closing_edge: unknown;
  readonly resolved_spanning_tree_parents: unknown;
  readonly resolved_fundamental_cycle_nodes: unknown;
  readonly resolved_persistence_span: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F463_FEATURE_ID>;
}

export type F463TopologicalCycleGeneratorLoopLocalizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F463_FEATURE_ID
>;

export const DEFAULT_F463_CONFIG: F463TopologicalCycleGeneratorLoopLocalizerConfig = {
  featureId: F463_FEATURE_ID,
  stage: F463_STAGE,
  operationCode: F463_OPERATION_CODE,
  contractVersion: F463_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F463TopologicalCycleGeneratorLoopLocalizerValidationError extends Error {
  public readonly featureId = F463_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F463 Validation Error on '${field}']: ${message}`);
    this.name = "F463TopologicalCycleGeneratorLoopLocalizerValidationError";
    this.field = field;
  }
}

export function computeF463Digest(rawPayload: string): string {
  return `f463_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F463TopologicalCycleGeneratorLoopLocalizerService extends KosmoraFeatureAdapterBase<
  typeof F463_FEATURE_ID,
  typeof F463_STAGE,
  typeof F463_OPERATION_CODE,
  F463TopologicalCycleGeneratorLoopLocalizerConfig,
  F463TopologicalCycleGeneratorLoopLocalizerInput,
  F463TopologicalCycleGeneratorLoopLocalizerOutput
> {
  constructor(
    customConfig?: Partial<F463TopologicalCycleGeneratorLoopLocalizerConfig>,
    kernel?: Stage15TopologicalPersistenceKernel
  ) {
    super(
      DEFAULT_F463_CONFIG,
      customConfig,
      kernel ?? Stage15TopologicalPersistenceKernel.getShared(),
      [
        "closing_edge",
        "spanning_tree_parents",
        "fundamental_cycle_nodes",
        "persistence_span"
      ] as const,
      F463TopologicalCycleGeneratorLoopLocalizerValidationError
    );
  }
}

export function verifyF463Module(): {
  readonly featureId: typeof F463_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F463TopologicalCycleGeneratorLoopLocalizerService();
  const sampleInput: F463TopologicalCycleGeneratorLoopLocalizerInput = {
    requestId: "req_verify_f463",
    projectId: "proj_kosmora_f463",
    workspaceId: "ws_kosmora_f463",
    tenantId: "tenant_rlm_f463",
    actorId: "actor_verifier_f463",
    autonomyLevel: "A3",
    closing_edge: "seed_f463_closing_edge",
    spanning_tree_parents: 42,
    fundamental_cycle_nodes: true,
    persistence_span: "seed_f463_persistence_span",
    metadata: { stage: "stage15-topological-persistence", featureId: "F463" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F463" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_closing_edge !== sampleInput.closing_edge &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F463] Verification failed`);
  }

  return {
    featureId: F463_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
