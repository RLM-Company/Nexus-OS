/**
 * F052 (stage2-canvas): Экспорт и синхронизация с Markdown / Notion
 * Копирование или пуш готовых структурированных материалов с сохранением форматирования
 * Operation Code: markdown_notion_bridge
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F052_FEATURE_ID = "F052" as const;
export const F052_STAGE = "stage2-canvas" as const;
export const F052_OPERATION_CODE = "markdown_notion_bridge" as const;
export const F052_CONTRACT_VERSION = "2.0.0" as const;

export type F052MarkdownNotionSynchronizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F052MarkdownNotionSynchronizerConfig {
  readonly featureId: typeof F052_FEATURE_ID;
  readonly stage: typeof F052_STAGE;
  readonly operationCode: typeof F052_OPERATION_CODE;
  readonly contractVersion: typeof F052_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F052MarkdownNotionSynchronizerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly notion_blocks_count: string | number;
  readonly gfm_markdown: string | number | boolean | readonly string[];
  readonly formatting_preserved: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F052MarkdownNotionSynchronizerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F052_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F052MarkdownNotionSynchronizerOutput {
  readonly featureId: typeof F052_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F052MarkdownNotionSynchronizerExecutionStatus;
  readonly operationCode: typeof F052_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_notion_blocks_count: string | number;
  readonly resolved_gfm_markdown: string | number | boolean | readonly string[];
  readonly resolved_formatting_preserved: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F052MarkdownNotionSynchronizerAuditEntry;
}

export interface F052MarkdownNotionSynchronizerTelemetrySnapshot {
  readonly featureId: typeof F052_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F052_CONFIG: F052MarkdownNotionSynchronizerConfig = {
  featureId: F052_FEATURE_ID,
  stage: F052_STAGE,
  operationCode: F052_OPERATION_CODE,
  contractVersion: F052_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F052MarkdownNotionSynchronizerValidationError extends Error {
  public readonly featureId = F052_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F052 Validation Error on '${field}']: ${message}`);
    this.name = "F052MarkdownNotionSynchronizerValidationError";
    this.field = field;
  }
}

export function computeF052Digest(rawPayload: string): string {
  return `f052_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F052MarkdownNotionSynchronizerEngine {
  private readonly config: F052MarkdownNotionSynchronizerConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F052MarkdownNotionSynchronizerOutput[] = [];
  private readonly auditLog: F052MarkdownNotionSynchronizerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F052MarkdownNotionSynchronizerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F052MarkdownNotionSynchronizerConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F052_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F052MarkdownNotionSynchronizerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F052MarkdownNotionSynchronizerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F052MarkdownNotionSynchronizerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F052MarkdownNotionSynchronizerValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      notion_blocks_count: input.notion_blocks_count,
      gfm_markdown: input.gfm_markdown,
      formatting_preserved: input.formatting_preserved
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F052MarkdownNotionSynchronizerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F052MarkdownNotionSynchronizerInput): F052MarkdownNotionSynchronizerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F052_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        notion_blocks_count: input.notion_blocks_count,
        gfm_markdown: input.gfm_markdown,
        formatting_preserved: input.formatting_preserved
      });
      const payloadHash = computeF052Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F052MarkdownNotionSynchronizerValidationError(
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
        featureId: F052_FEATURE_ID,
        operationCode: F052_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          notion_blocks_count: input.notion_blocks_count,
          gfm_markdown: input.gfm_markdown,
          formatting_preserved: input.formatting_preserved
        }
      });

      const executionId = `exec_f052_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f052_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F052MarkdownNotionSynchronizerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F052_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `markdown_notion_bridge:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F052MarkdownNotionSynchronizerOutput = {
        featureId: F052_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F052_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_notion_blocks_count: kernelResult.resolvedFields.notion_blocks_count as string | number,
        resolved_gfm_markdown: kernelResult.resolvedFields.gfm_markdown as string | number | boolean | readonly string[],
        resolved_formatting_preserved: kernelResult.resolvedFields.formatting_preserved as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F052MarkdownNotionSynchronizerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F052_FEATURE_ID,
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

  public getAuditTrail(): readonly F052MarkdownNotionSynchronizerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F052MarkdownNotionSynchronizerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF052Module(): {
  featureId: typeof F052_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F052MarkdownNotionSynchronizerEngine();
  const sampleInput: F052MarkdownNotionSynchronizerInput = {
    requestId: "req_verify_f052",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f052_artifact_id_seed",
    notion_blocks_count: 42,
    gfm_markdown: true,
    formatting_preserved: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 52 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F052" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F052_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
