import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage16WasmEvolutionarySynthKernel } from "./stage-kernel.js";

export const F498_FEATURE_ID = "F498" as const;
export const F498_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F498_OPERATION_CODE = "F498_MINIMAL_STRUCTURAL_AST_PATCH_SCRIPT_GENERATOR" as const;
export const F498_CONTRACT_VERSION = "2.0.0" as const;

export type F498MinimalStructuralAstPatchScriptGeneratorConfig = BaseFeatureConfig<
  typeof F498_FEATURE_ID,
  typeof F498_STAGE,
  typeof F498_OPERATION_CODE
>;

export interface F498MinimalStructuralAstPatchScriptGeneratorInput extends BaseFeatureInput {
  readonly dp_backtrack_table: string | number | boolean | readonly string[];
  readonly edit_operations_list: string | number | boolean | readonly string[];
  readonly insert_delete_rename_counts: string | number | boolean | readonly string[];
  readonly reconstructed_match: string | number | boolean | readonly string[];
}

export interface F498MinimalStructuralAstPatchScriptGeneratorOutput {
  readonly featureId: typeof F498_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F498_OPERATION_CODE;
  readonly resolved_dp_backtrack_table: unknown;
  readonly resolved_edit_operations_list: unknown;
  readonly resolved_insert_delete_rename_counts: unknown;
  readonly resolved_reconstructed_match: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F498_FEATURE_ID>;
}

export type F498MinimalStructuralAstPatchScriptGeneratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F498_FEATURE_ID
>;

export const DEFAULT_F498_CONFIG: F498MinimalStructuralAstPatchScriptGeneratorConfig = {
  featureId: F498_FEATURE_ID,
  stage: F498_STAGE,
  operationCode: F498_OPERATION_CODE,
  contractVersion: F498_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F498MinimalStructuralAstPatchScriptGeneratorValidationError extends Error {
  public readonly featureId = F498_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F498 Validation Error on '${field}']: ${message}`);
    this.name = "F498MinimalStructuralAstPatchScriptGeneratorValidationError";
    this.field = field;
  }
}

export function computeF498Digest(rawPayload: string): string {
  return `f498_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F498MinimalStructuralAstPatchScriptGeneratorService extends KosmoraFeatureAdapterBase<
  typeof F498_FEATURE_ID,
  typeof F498_STAGE,
  typeof F498_OPERATION_CODE,
  F498MinimalStructuralAstPatchScriptGeneratorConfig,
  F498MinimalStructuralAstPatchScriptGeneratorInput,
  F498MinimalStructuralAstPatchScriptGeneratorOutput
> {
  constructor(
    customConfig?: Partial<F498MinimalStructuralAstPatchScriptGeneratorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F498_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "dp_backtrack_table",
        "edit_operations_list",
        "insert_delete_rename_counts",
        "reconstructed_match"
      ] as const,
      F498MinimalStructuralAstPatchScriptGeneratorValidationError
    );
  }
}

export function verifyF498Module(): {
  readonly featureId: typeof F498_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F498MinimalStructuralAstPatchScriptGeneratorService();
  const sampleInput: F498MinimalStructuralAstPatchScriptGeneratorInput = {
    requestId: "req_verify_f498",
    projectId: "proj_kosmora_f498",
    workspaceId: "ws_kosmora_f498",
    tenantId: "tenant_rlm_f498",
    actorId: "actor_verifier_f498",
    autonomyLevel: "A3",
    dp_backtrack_table: "seed_f498_dp_backtrack_table",
    edit_operations_list: 42,
    insert_delete_rename_counts: true,
    reconstructed_match: "seed_f498_reconstructed_match",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F498" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F498" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_dp_backtrack_table !== sampleInput.dp_backtrack_table &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F498] Verification failed`);
  }

  return {
    featureId: F498_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
