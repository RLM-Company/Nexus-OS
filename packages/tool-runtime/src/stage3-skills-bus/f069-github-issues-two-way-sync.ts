/**
 * F069 (stage3-skills-bus): Двусторонняя интеграция с GitHub Issues
 * Чтение бэклога, создание новых ишью из планов на Canvas и авто-закрытие по коммиту
 * Operation Code: github_issues_bridge
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

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

export interface F069GithubIssuesTwoWaySyncConfig {
  readonly featureId: typeof F069_FEATURE_ID;
  readonly stage: typeof F069_STAGE;
  readonly operationCode: typeof F069_OPERATION_CODE;
  readonly contractVersion: typeof F069_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F069GithubIssuesTwoWaySyncInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly repo_name: string;
  readonly issue_number: string | number;
  readonly sync_state: string | number | boolean | readonly string[];
  readonly linked_artifact_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F069GithubIssuesTwoWaySyncAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F069_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

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

export interface F069GithubIssuesTwoWaySyncTelemetrySnapshot {
  readonly featureId: typeof F069_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

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

export class F069GithubIssuesTwoWaySyncEngine {
  private readonly config: F069GithubIssuesTwoWaySyncConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F069GithubIssuesTwoWaySyncOutput[] = [];
  private readonly auditLog: F069GithubIssuesTwoWaySyncAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F069GithubIssuesTwoWaySyncOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F069GithubIssuesTwoWaySyncConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F069_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F069GithubIssuesTwoWaySyncConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F069GithubIssuesTwoWaySyncInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F069GithubIssuesTwoWaySyncValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.repo_name).trim().length === 0) {
      throw new F069GithubIssuesTwoWaySyncValidationError("repo_name", "Primary domain attribute 'repo_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      repo_name: input.repo_name,
      issue_number: input.issue_number,
      sync_state: input.sync_state,
      linked_artifact_id: input.linked_artifact_id
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F069GithubIssuesTwoWaySyncValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F069GithubIssuesTwoWaySyncInput): F069GithubIssuesTwoWaySyncOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F069_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        repo_name: input.repo_name,
        issue_number: input.issue_number,
        sync_state: input.sync_state,
        linked_artifact_id: input.linked_artifact_id
      });
      const payloadHash = computeF069Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F069GithubIssuesTwoWaySyncValidationError(
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
        featureId: F069_FEATURE_ID,
        operationCode: F069_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          repo_name: input.repo_name,
          issue_number: input.issue_number,
          sync_state: input.sync_state,
          linked_artifact_id: input.linked_artifact_id
        }
      });

      const executionId = `exec_f069_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f069_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F069GithubIssuesTwoWaySyncAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F069_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `github_issues_bridge:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F069GithubIssuesTwoWaySyncOutput = {
        featureId: F069_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F069_OPERATION_CODE,
        resolved_repo_name: kernelResult.resolvedFields.repo_name as string,
        resolved_issue_number: kernelResult.resolvedFields.issue_number as string | number,
        resolved_sync_state: kernelResult.resolvedFields.sync_state as string | number | boolean | readonly string[],
        resolved_linked_artifact_id: kernelResult.resolvedFields.linked_artifact_id as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F069GithubIssuesTwoWaySyncTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F069_FEATURE_ID,
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

  public getAuditTrail(): readonly F069GithubIssuesTwoWaySyncAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F069GithubIssuesTwoWaySyncOutput[] {
    return [...this.executionHistory];
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
