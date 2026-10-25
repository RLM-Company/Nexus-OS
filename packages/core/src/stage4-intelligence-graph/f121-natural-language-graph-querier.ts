/**
 * F121 (stage4-intelligence-graph): Запросы к графу на естественном языке
 * Перевод вопроса пользователя в обход узлов графа для точных ответов по связям
 * Operation Code: nl_graph_traversal
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F121_FEATURE_ID = "F121" as const;
export const F121_STAGE = "stage4-intelligence-graph" as const;
export const F121_OPERATION_CODE = "nl_graph_traversal" as const;
export const F121_CONTRACT_VERSION = "2.0.0" as const;

export type F121NaturalLanguageGraphQuerierExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F121NaturalLanguageGraphQuerierConfig {
  readonly featureId: typeof F121_FEATURE_ID;
  readonly stage: typeof F121_STAGE;
  readonly operationCode: typeof F121_OPERATION_CODE;
  readonly contractVersion: typeof F121_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F121NaturalLanguageGraphQuerierInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly natural_question: string;
  readonly cypher_like_plan: string | number;
  readonly traversed_path: string | number | boolean | readonly string[];
  readonly synthesized_answer: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F121NaturalLanguageGraphQuerierAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F121_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F121NaturalLanguageGraphQuerierOutput {
  readonly featureId: typeof F121_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F121NaturalLanguageGraphQuerierExecutionStatus;
  readonly operationCode: typeof F121_OPERATION_CODE;
  readonly resolved_natural_question: string;
  readonly resolved_cypher_like_plan: string | number;
  readonly resolved_traversed_path: string | number | boolean | readonly string[];
  readonly resolved_synthesized_answer: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F121NaturalLanguageGraphQuerierAuditEntry;
}

export interface F121NaturalLanguageGraphQuerierTelemetrySnapshot {
  readonly featureId: typeof F121_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F121_CONFIG: F121NaturalLanguageGraphQuerierConfig = {
  featureId: F121_FEATURE_ID,
  stage: F121_STAGE,
  operationCode: F121_OPERATION_CODE,
  contractVersion: F121_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F121NaturalLanguageGraphQuerierValidationError extends Error {
  public readonly featureId = F121_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F121 Validation Error on '${field}']: ${message}`);
    this.name = "F121NaturalLanguageGraphQuerierValidationError";
    this.field = field;
  }
}

export function computeF121Digest(rawPayload: string): string {
  return `f121_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F121NaturalLanguageGraphQuerierEngine {
  private readonly config: F121NaturalLanguageGraphQuerierConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F121NaturalLanguageGraphQuerierOutput[] = [];
  private readonly auditLog: F121NaturalLanguageGraphQuerierAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F121NaturalLanguageGraphQuerierOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F121NaturalLanguageGraphQuerierConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F121_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F121NaturalLanguageGraphQuerierConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F121NaturalLanguageGraphQuerierInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F121NaturalLanguageGraphQuerierValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.natural_question).trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("natural_question", "Primary domain attribute 'natural_question' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      natural_question: input.natural_question,
      cypher_like_plan: input.cypher_like_plan,
      traversed_path: input.traversed_path,
      synthesized_answer: input.synthesized_answer
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F121NaturalLanguageGraphQuerierValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F121NaturalLanguageGraphQuerierInput): F121NaturalLanguageGraphQuerierOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F121_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        natural_question: input.natural_question,
        cypher_like_plan: input.cypher_like_plan,
        traversed_path: input.traversed_path,
        synthesized_answer: input.synthesized_answer
      });
      const payloadHash = computeF121Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F121NaturalLanguageGraphQuerierValidationError(
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
        featureId: F121_FEATURE_ID,
        operationCode: F121_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          natural_question: input.natural_question,
          cypher_like_plan: input.cypher_like_plan,
          traversed_path: input.traversed_path,
          synthesized_answer: input.synthesized_answer
        }
      });

      const executionId = `exec_f121_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f121_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F121NaturalLanguageGraphQuerierAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F121_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `nl_graph_traversal:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F121NaturalLanguageGraphQuerierOutput = {
        featureId: F121_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F121_OPERATION_CODE,
        resolved_natural_question: kernelResult.resolvedFields.natural_question as string,
        resolved_cypher_like_plan: kernelResult.resolvedFields.cypher_like_plan as string | number,
        resolved_traversed_path: kernelResult.resolvedFields.traversed_path as string | number | boolean | readonly string[],
        resolved_synthesized_answer: kernelResult.resolvedFields.synthesized_answer as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F121NaturalLanguageGraphQuerierTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F121_FEATURE_ID,
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

  public getAuditTrail(): readonly F121NaturalLanguageGraphQuerierAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F121NaturalLanguageGraphQuerierOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF121Module(): {
  featureId: typeof F121_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F121NaturalLanguageGraphQuerierEngine();
  const sampleInput: F121NaturalLanguageGraphQuerierInput = {
    requestId: "req_verify_f121",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    natural_question: "f121_natural_question_seed",
    cypher_like_plan: 42,
    traversed_path: true,
    synthesized_answer: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 121 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F121" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_natural_question !== sampleInput.natural_question &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F121_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
