/**
 * F069 (stage3-skills-bus): Двусторонняя интеграция с GitHub Issues
 * Чтение бэклога, создание новых ишью из планов на Canvas и авто-закрытие по коммиту
 * Operation Code: github_issues_bridge
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F069_FEATURE_ID = "F069" as const;
export const F069_STAGE = "stage3-skills-bus" as const;
export const F069_OPERATION_CODE = "github_issues_bridge" as const;
export const F069_CONTRACT_VERSION = "2.0.0" as const;

export type F069GithubIssuesTwoWaySyncExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F069GithubIssuesTwoWaySyncConfig = BaseFeatureConfig<
  typeof F069_FEATURE_ID,
  typeof F069_STAGE,
  typeof F069_OPERATION_CODE
>;

export interface F069GithubIssuesTwoWaySyncInput extends BaseFeatureInput {
  readonly repo_name: string;
  readonly issue_number: string | number;
  readonly sync_state: string | number | boolean | readonly string[];
  readonly linked_artifact_id: string | number | boolean | Record<string, unknown>;
}

export type F069GithubIssuesTwoWaySyncAuditEntry = BaseFeatureAuditEntry<typeof F069_FEATURE_ID>;

export interface F069GithubIssuesTwoWaySyncOutput {
  readonly featureId: typeof F069_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F069GithubIssuesTwoWaySyncExecutionStatus;
  readonly operationCode: typeof F069_OPERATION_CODE;
  readonly resolved_repo_name: string;
  readonly resolved_issue_number: string | number;
  readonly resolved_sync_state: string | number | boolean | readonly string[];
  readonly resolved_linked_artifact_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F069GithubIssuesTwoWaySyncAuditEntry;
}

export type F069GithubIssuesTwoWaySyncTelemetrySnapshot = BaseFeatureTelemetry<typeof F069_FEATURE_ID>;

export const DEFAULT_F069_CONFIG: F069GithubIssuesTwoWaySyncConfig = {
  featureId: F069_FEATURE_ID,
  stage: F069_STAGE,
  operationCode: F069_OPERATION_CODE,
  contractVersion: F069_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F069GithubIssuesTwoWaySyncValidationError extends Error {
  public readonly featureId = F069_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F069 Validation Error on '${field}']: ${message}`);
    this.name = "F069GithubIssuesTwoWaySyncValidationError";
    this.field = field;
  }
}

export function computeF069Digest(rawPayload: string): string {
  return `f069_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F069GithubIssuesTwoWaySyncEngine extends KosmoraFeatureAdapterBase<
  typeof F069_FEATURE_ID,
  typeof F069_STAGE,
  typeof F069_OPERATION_CODE,
  F069GithubIssuesTwoWaySyncConfig,
  F069GithubIssuesTwoWaySyncInput,
  F069GithubIssuesTwoWaySyncOutput
> {
  constructor(customConfig?: Partial<F069GithubIssuesTwoWaySyncConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F069_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["repo_name", "issue_number", "sync_state", "linked_artifact_id"] as const,
      F069GithubIssuesTwoWaySyncValidationError
    );
  }
}

export function verifyF069Module(): {
  featureId: typeof F069_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F069GithubIssuesTwoWaySyncEngine();
  const sampleInput: F069GithubIssuesTwoWaySyncInput = {
    requestId: "req_verify_f069",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    repo_name: "f069_repo_name_seed",
    issue_number: 42,
    sync_state: true,
    linked_artifact_id: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 69 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F069" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_repo_name !== sampleInput.repo_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F069_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
