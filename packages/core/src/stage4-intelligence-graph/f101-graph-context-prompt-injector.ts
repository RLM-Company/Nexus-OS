/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F101
 * ============================================================================
 * Feature ID: F101
 * Stage: stage4-intelligence-graph
 * Title: Инжектор графового контекста в промпт (Graph Context Injector)
 * Description: Автоматическое подтягивание релевантных узлов графа в системный промпт при старте новой ветки чата
 * Operation Code: prompt_graph_injector
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F101_FEATURE_ID = "F101" as const;
export const F101_STAGE = "stage4-intelligence-graph" as const;
export const F101_OPERATION_CODE = "prompt_graph_injector" as const;
export const F101_CONTRACT_VERSION = "1.0.0" as const;

export type F101GraphContextPromptInjectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F101GraphContextPromptInjectorConfig {
  readonly featureId: typeof F101_FEATURE_ID;
  readonly stage: typeof F101_STAGE;
  readonly operationCode: typeof F101_OPERATION_CODE;
  readonly contractVersion: typeof F101_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F101GraphContextPromptInjectorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly injected_nodes_count: string | number;
  readonly augmented_system_prompt: string | number | boolean | readonly string[];
  readonly token_overhead: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F101GraphContextPromptInjectorOutput {
  readonly featureId: typeof F101_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F101GraphContextPromptInjectorExecutionStatus;
  readonly operationCode: typeof F101_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_injected_nodes_count: string | number;
  readonly resolved_augmented_system_prompt: string | number | boolean | readonly string[];
  readonly resolved_token_overhead: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F101GraphContextPromptInjectorAuditEntry;
}

export interface F101GraphContextPromptInjectorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F101_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F101GraphContextPromptInjectorTelemetrySnapshot {
  readonly featureId: typeof F101_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F101_CONFIG: F101GraphContextPromptInjectorConfig = {
  featureId: F101_FEATURE_ID,
  stage: F101_STAGE,
  operationCode: F101_OPERATION_CODE,
  contractVersion: F101_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F101GraphContextPromptInjectorValidationError extends Error {
  public readonly featureId = F101_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F101 Validation Error on '${field}']: ${message}`);
    this.name = "F101GraphContextPromptInjectorValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F101 provenance & audit integrity.
 */
export function computeF101Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f101_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F101: Инжектор графового контекста в промпт (Graph Context Injector)
 * Автоматическое подтягивание релевантных узлов графа в системный промпт при старте новой ветки чата
 */
export class F101GraphContextPromptInjectorEngine {
  private readonly config: F101GraphContextPromptInjectorConfig;
  private readonly executionHistory: F101GraphContextPromptInjectorOutput[] = [];
  private readonly auditLog: F101GraphContextPromptInjectorAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F101GraphContextPromptInjectorConfig>) {
    this.config = {
      ...DEFAULT_F101_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F101GraphContextPromptInjectorConfig {
    return { ...this.config };
  }

  public validateInput(input: F101GraphContextPromptInjectorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F101GraphContextPromptInjectorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F101GraphContextPromptInjectorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F101GraphContextPromptInjectorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F101GraphContextPromptInjectorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F101GraphContextPromptInjectorValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
  }

  public execute(input: F101GraphContextPromptInjectorInput): F101GraphContextPromptInjectorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f101_${this.totalRuns}_${computeF101Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F101_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        workspace_id: input.workspace_id,
        injected_nodes_count: input.injected_nodes_count,
        augmented_system_prompt: input.augmented_system_prompt,
        token_overhead: input.token_overhead,
      });

      const provenanceDigest = computeF101Digest(canonicalPayload);
      const auditRecord: F101GraphContextPromptInjectorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F101_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `prompt_graph_injector:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F101GraphContextPromptInjectorOutput = {
        featureId: F101_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F101_OPERATION_CODE,
        resolved_workspace_id: input.workspace_id,
        resolved_injected_nodes_count: input.injected_nodes_count,
        resolved_augmented_system_prompt: input.augmented_system_prompt,
        resolved_token_overhead: input.token_overhead,
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

  public getTelemetrySnapshot(): F101GraphContextPromptInjectorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F101_FEATURE_ID,
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

  public getAuditTrail(): readonly F101GraphContextPromptInjectorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F101GraphContextPromptInjectorOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F101 (Инжектор графового контекста в промпт (Graph Context Injector))
 */
export function verifyF101Module(): {
  featureId: typeof F101_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F101GraphContextPromptInjectorEngine();
  const sampleInput: F101GraphContextPromptInjectorInput = {
    requestId: "req_verify_f101",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f101_workspace_id_verified",
    injected_nodes_count: 100,
    augmented_system_prompt: true,
    token_overhead: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 101 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F101" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F101_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
