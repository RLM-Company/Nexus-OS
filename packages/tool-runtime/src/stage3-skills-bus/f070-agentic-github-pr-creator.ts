/**
 * F070 (stage3-skills-bus): Агентное создание веток и Pull Request в GitHub
 * Формирование PR с описанием изменений, привязанными артефактами и тегами ревьюеров
 * Operation Code: github_pr_automator
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F070_FEATURE_ID = "F070" as const;
export const F070_STAGE = "stage3-skills-bus" as const;
export const F070_OPERATION_CODE = "github_pr_automator" as const;
export const F070_CONTRACT_VERSION = "2.0.0" as const;

export type F070AgenticGithubPrCreatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F070AgenticGithubPrCreatorConfig {
  readonly featureId: typeof F070_FEATURE_ID;
  readonly stage: typeof F070_STAGE;
  readonly operationCode: typeof F070_OPERATION_CODE;
  readonly contractVersion: typeof F070_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F070AgenticGithubPrCreatorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly repo_name: string;
  readonly head_branch: string | number;
  readonly base_branch: string | number | boolean | readonly string[];
  readonly pr_body_markdown: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F070AgenticGithubPrCreatorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F070_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F070AgenticGithubPrCreatorOutput {
  readonly featureId: typeof F070_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F070AgenticGithubPrCreatorExecutionStatus;
  readonly operationCode: typeof F070_OPERATION_CODE;
  readonly resolved_repo_name: string;
  readonly resolved_head_branch: string | number;
  readonly resolved_base_branch: string | number | boolean | readonly string[];
  readonly resolved_pr_body_markdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F070AgenticGithubPrCreatorAuditEntry;
}

export interface F070AgenticGithubPrCreatorTelemetrySnapshot {
  readonly featureId: typeof F070_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F070_CONFIG: F070AgenticGithubPrCreatorConfig = {
  featureId: F070_FEATURE_ID,
  stage: F070_STAGE,
  operationCode: F070_OPERATION_CODE,
  contractVersion: F070_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F070AgenticGithubPrCreatorValidationError extends Error {
  public readonly featureId = F070_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F070 Validation Error on '${field}']: ${message}`);
    this.name = "F070AgenticGithubPrCreatorValidationError";
    this.field = field;
  }
}

export function computeF070Digest(rawPayload: string): string {
  return `f070_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F070AgenticGithubPrCreatorEngine {
  private readonly config: F070AgenticGithubPrCreatorConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F070AgenticGithubPrCreatorOutput[] = [];
  private readonly auditLog: F070AgenticGithubPrCreatorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F070AgenticGithubPrCreatorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F070AgenticGithubPrCreatorConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F070_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F070AgenticGithubPrCreatorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F070AgenticGithubPrCreatorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F070AgenticGithubPrCreatorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.repo_name).trim().length === 0) {
      throw new F070AgenticGithubPrCreatorValidationError("repo_name", "Primary domain attribute 'repo_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      repo_name: input.repo_name,
      head_branch: input.head_branch,
      base_branch: input.base_branch,
      pr_body_markdown: input.pr_body_markdown
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F070AgenticGithubPrCreatorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F070AgenticGithubPrCreatorInput): F070AgenticGithubPrCreatorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F070_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        repo_name: input.repo_name,
        head_branch: input.head_branch,
        base_branch: input.base_branch,
        pr_body_markdown: input.pr_body_markdown
      });
      const payloadHash = computeF070Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F070AgenticGithubPrCreatorValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F070_FEATURE_ID,
        operationCode: F070_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          repo_name: input.repo_name,
          head_branch: input.head_branch,
          base_branch: input.base_branch,
          pr_body_markdown: input.pr_body_markdown
        }
      });

      const executionId = `exec_f070_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f070_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F070AgenticGithubPrCreatorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F070_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `github_pr_automator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F070AgenticGithubPrCreatorOutput = {
        featureId: F070_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F070_OPERATION_CODE,
        resolved_repo_name: kernelResult.resolvedFields.repo_name as string,
        resolved_head_branch: kernelResult.resolvedFields.head_branch as string | number,
        resolved_base_branch: kernelResult.resolvedFields.base_branch as string | number | boolean | readonly string[],
        resolved_pr_body_markdown: kernelResult.resolvedFields.pr_body_markdown as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F070AgenticGithubPrCreatorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F070_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0
    };
  }

  public getAuditTrail(): readonly F070AgenticGithubPrCreatorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F070AgenticGithubPrCreatorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF070Module(): {
  featureId: typeof F070_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F070AgenticGithubPrCreatorEngine();
  const sampleInput: F070AgenticGithubPrCreatorInput = {
    requestId: "req_verify_f070",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    repo_name: "f070_repo_name_seed",
    head_branch: 42,
    base_branch: true,
    pr_body_markdown: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 70 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F070" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_repo_name !== sampleInput.repo_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F070_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
