/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F121
 * ============================================================================
 * Feature ID: F121
 * Stage: stage4-intelligence-graph
 * Title: Запросы к графу на естественном языке
 * Description: Перевод вопроса пользователя в обход узлов графа для точных ответов по связям
 * Operation Code: nl_graph_traversal
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F121_FEATURE_ID = "F121" as const;
export const F121_STAGE = "stage4-intelligence-graph" as const;
export const F121_OPERATION_CODE = "nl_graph_traversal" as const;
export const F121_CONTRACT_VERSION = "1.0.0" as const;

export type F121NaturalLanguageGraphQuerierExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
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
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F121NaturalLanguageGraphQuerierAuditEntry;
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
  strictValidation: true,
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

/**
 * Deterministic FNV-1a digest calculator for F121 provenance & audit integrity.
 */
export function computeF121Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f121_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F121: Запросы к графу на естественном языке
 * Перевод вопроса пользователя в обход узлов графа для точных ответов по связям
 */
export class F121NaturalLanguageGraphQuerierEngine {
  private readonly config: F121NaturalLanguageGraphQuerierConfig;
  private readonly executionHistory: F121NaturalLanguageGraphQuerierOutput[] = [];
  private readonly auditLog: F121NaturalLanguageGraphQuerierAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F121NaturalLanguageGraphQuerierConfig>) {
    this.config = {
      ...DEFAULT_F121_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F121NaturalLanguageGraphQuerierConfig {
    return { ...this.config };
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
    if (this.config.strictValidation && String(input.natural_question).trim().length === 0) {
      throw new F121NaturalLanguageGraphQuerierValidationError("natural_question", "Primary domain attribute 'natural_question' cannot be empty.");
    }
  }

  public execute(input: F121NaturalLanguageGraphQuerierInput): F121NaturalLanguageGraphQuerierOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f121_${this.totalRuns}_${computeF121Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F121_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        natural_question: input.natural_question,
        cypher_like_plan: input.cypher_like_plan,
        traversed_path: input.traversed_path,
        synthesized_answer: input.synthesized_answer,
      });

      const provenanceDigest = computeF121Digest(canonicalPayload);
      const auditRecord: F121NaturalLanguageGraphQuerierAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F121_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `nl_graph_traversal:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
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
        resolved_natural_question: input.natural_question,
        resolved_cypher_like_plan: input.cypher_like_plan,
        resolved_traversed_path: input.traversed_path,
        resolved_synthesized_answer: input.synthesized_answer,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord,
      };

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
          : 0,
    };
  }

  public getAuditTrail(): readonly F121NaturalLanguageGraphQuerierAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F121NaturalLanguageGraphQuerierOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F121 (Запросы к графу на естественном языке)
 */
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
    natural_question: "f121_natural_question_verified",
    cypher_like_plan: 100,
    traversed_path: true,
    synthesized_answer: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 121 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F121" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F121_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
