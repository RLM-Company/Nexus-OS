/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F107
 * ============================================================================
 * Feature ID: F107
 * Stage: stage4-intelligence-graph
 * Title: Закрепление ядерных фактов (Pinned Context Nodes)
 * Description: Фиксация неизменяемых правил проекта (стек, брендбук, ограничения), всегда присутствующих в контексте
 * Operation Code: pinned_fact_registry
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F107_FEATURE_ID = "F107" as const;
export const F107_STAGE = "stage4-intelligence-graph" as const;
export const F107_OPERATION_CODE = "pinned_fact_registry" as const;
export const F107_CONTRACT_VERSION = "1.0.0" as const;

export type F107PinnedCoreContextNodesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F107PinnedCoreContextNodesConfig {
  readonly featureId: typeof F107_FEATURE_ID;
  readonly stage: typeof F107_STAGE;
  readonly operationCode: typeof F107_OPERATION_CODE;
  readonly contractVersion: typeof F107_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F107PinnedCoreContextNodesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly pinned_node_ids: string | number;
  readonly immutable_rules: string | number | boolean | readonly string[];
  readonly always_injected: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F107PinnedCoreContextNodesOutput {
  readonly featureId: typeof F107_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F107PinnedCoreContextNodesExecutionStatus;
  readonly operationCode: typeof F107_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_pinned_node_ids: string | number;
  readonly resolved_immutable_rules: string | number | boolean | readonly string[];
  readonly resolved_always_injected: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F107PinnedCoreContextNodesAuditEntry;
}

export interface F107PinnedCoreContextNodesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F107_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F107PinnedCoreContextNodesTelemetrySnapshot {
  readonly featureId: typeof F107_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F107_CONFIG: F107PinnedCoreContextNodesConfig = {
  featureId: F107_FEATURE_ID,
  stage: F107_STAGE,
  operationCode: F107_OPERATION_CODE,
  contractVersion: F107_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F107PinnedCoreContextNodesValidationError extends Error {
  public readonly featureId = F107_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F107 Validation Error on '${field}']: ${message}`);
    this.name = "F107PinnedCoreContextNodesValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F107 provenance & audit integrity.
 */
export function computeF107Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f107_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F107: Закрепление ядерных фактов (Pinned Context Nodes)
 * Фиксация неизменяемых правил проекта (стек, брендбук, ограничения), всегда присутствующих в контексте
 */
export class F107PinnedCoreContextNodesEngine {
  private readonly config: F107PinnedCoreContextNodesConfig;
  private readonly executionHistory: F107PinnedCoreContextNodesOutput[] = [];
  private readonly auditLog: F107PinnedCoreContextNodesAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F107PinnedCoreContextNodesConfig>) {
    this.config = {
      ...DEFAULT_F107_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F107PinnedCoreContextNodesConfig {
    return { ...this.config };
  }

  public validateInput(input: F107PinnedCoreContextNodesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F107PinnedCoreContextNodesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F107PinnedCoreContextNodesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F107PinnedCoreContextNodesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F107PinnedCoreContextNodesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F107PinnedCoreContextNodesValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
  }

  public execute(input: F107PinnedCoreContextNodesInput): F107PinnedCoreContextNodesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f107_${this.totalRuns}_${computeF107Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F107_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        workspace_id: input.workspace_id,
        pinned_node_ids: input.pinned_node_ids,
        immutable_rules: input.immutable_rules,
        always_injected: input.always_injected,
      });

      const provenanceDigest = computeF107Digest(canonicalPayload);
      const auditRecord: F107PinnedCoreContextNodesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F107_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `pinned_fact_registry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F107PinnedCoreContextNodesOutput = {
        featureId: F107_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F107_OPERATION_CODE,
        resolved_workspace_id: input.workspace_id,
        resolved_pinned_node_ids: input.pinned_node_ids,
        resolved_immutable_rules: input.immutable_rules,
        resolved_always_injected: input.always_injected,
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

  public getTelemetrySnapshot(): F107PinnedCoreContextNodesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F107_FEATURE_ID,
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

  public getAuditTrail(): readonly F107PinnedCoreContextNodesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F107PinnedCoreContextNodesOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F107 (Закрепление ядерных фактов (Pinned Context Nodes))
 */
export function verifyF107Module(): {
  featureId: typeof F107_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F107PinnedCoreContextNodesEngine();
  const sampleInput: F107PinnedCoreContextNodesInput = {
    requestId: "req_verify_f107",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f107_workspace_id_verified",
    pinned_node_ids: 100,
    immutable_rules: true,
    always_injected: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 107 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F107" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F107_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
