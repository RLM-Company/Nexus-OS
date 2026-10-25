/**
 * F087 (stage3-skills-bus): Умный буфер обмена и сниппеты
 * Быстрое сохранение удачных фрагментов кода и таблиц в боковую панель
 * Operation Code: snippet_vault_clipboard
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F087_FEATURE_ID = "F087" as const;
export const F087_STAGE = "stage3-skills-bus" as const;
export const F087_OPERATION_CODE = "snippet_vault_clipboard" as const;
export const F087_CONTRACT_VERSION = "2.0.0" as const;

export type F087SmartClipboardSnippetsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F087SmartClipboardSnippetsConfig {
  readonly featureId: typeof F087_FEATURE_ID;
  readonly stage: typeof F087_STAGE;
  readonly operationCode: typeof F087_OPERATION_CODE;
  readonly contractVersion: typeof F087_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F087SmartClipboardSnippetsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly snippet_id: string;
  readonly title: string | number;
  readonly language_tag: string | number | boolean | readonly string[];
  readonly reusable_content: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F087SmartClipboardSnippetsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F087_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F087SmartClipboardSnippetsOutput {
  readonly featureId: typeof F087_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F087SmartClipboardSnippetsExecutionStatus;
  readonly operationCode: typeof F087_OPERATION_CODE;
  readonly resolved_snippet_id: string;
  readonly resolved_title: string | number;
  readonly resolved_language_tag: string | number | boolean | readonly string[];
  readonly resolved_reusable_content: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F087SmartClipboardSnippetsAuditEntry;
}

export interface F087SmartClipboardSnippetsTelemetrySnapshot {
  readonly featureId: typeof F087_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F087_CONFIG: F087SmartClipboardSnippetsConfig = {
  featureId: F087_FEATURE_ID,
  stage: F087_STAGE,
  operationCode: F087_OPERATION_CODE,
  contractVersion: F087_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F087SmartClipboardSnippetsValidationError extends Error {
  public readonly featureId = F087_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F087 Validation Error on '${field}']: ${message}`);
    this.name = "F087SmartClipboardSnippetsValidationError";
    this.field = field;
  }
}

export function computeF087Digest(rawPayload: string): string {
  return `f087_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F087SmartClipboardSnippetsEngine {
  private readonly config: F087SmartClipboardSnippetsConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F087SmartClipboardSnippetsOutput[] = [];
  private readonly auditLog: F087SmartClipboardSnippetsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F087SmartClipboardSnippetsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F087SmartClipboardSnippetsConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F087_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F087SmartClipboardSnippetsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F087SmartClipboardSnippetsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F087SmartClipboardSnippetsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.snippet_id).trim().length === 0) {
      throw new F087SmartClipboardSnippetsValidationError("snippet_id", "Primary domain attribute 'snippet_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      snippet_id: input.snippet_id,
      title: input.title,
      language_tag: input.language_tag,
      reusable_content: input.reusable_content
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F087SmartClipboardSnippetsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F087SmartClipboardSnippetsInput): F087SmartClipboardSnippetsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F087_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        snippet_id: input.snippet_id,
        title: input.title,
        language_tag: input.language_tag,
        reusable_content: input.reusable_content
      });
      const payloadHash = computeF087Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F087SmartClipboardSnippetsValidationError(
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
        featureId: F087_FEATURE_ID,
        operationCode: F087_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          snippet_id: input.snippet_id,
          title: input.title,
          language_tag: input.language_tag,
          reusable_content: input.reusable_content
        }
      });

      const executionId = `exec_f087_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f087_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F087SmartClipboardSnippetsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F087_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `snippet_vault_clipboard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F087SmartClipboardSnippetsOutput = {
        featureId: F087_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F087_OPERATION_CODE,
        resolved_snippet_id: kernelResult.resolvedFields.snippet_id as string,
        resolved_title: kernelResult.resolvedFields.title as string | number,
        resolved_language_tag: kernelResult.resolvedFields.language_tag as string | number | boolean | readonly string[],
        resolved_reusable_content: kernelResult.resolvedFields.reusable_content as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F087SmartClipboardSnippetsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F087_FEATURE_ID,
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

  public getAuditTrail(): readonly F087SmartClipboardSnippetsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F087SmartClipboardSnippetsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF087Module(): {
  featureId: typeof F087_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F087SmartClipboardSnippetsEngine();
  const sampleInput: F087SmartClipboardSnippetsInput = {
    requestId: "req_verify_f087",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    snippet_id: "f087_snippet_id_seed",
    title: 42,
    language_tag: true,
    reusable_content: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 87 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F087" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_snippet_id !== sampleInput.snippet_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F087_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
