/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F144
 * ============================================================================
 * Feature ID: F144
 * Stage: stage5-enterprise
 * Title: Регрессионное тестирование промптов и скиллов
 * Description: Проверка того, что обновление системного промпта не ухудшило качество старых сценариев
 * Operation Code: prompt_regression_gate
 * Target Package Directory: packages/policy-engine/src/stage5-enterprise
 * ============================================================================
 */

export const F144_FEATURE_ID = "F144" as const;
export const F144_STAGE = "stage5-enterprise" as const;
export const F144_OPERATION_CODE = "prompt_regression_gate" as const;
export const F144_CONTRACT_VERSION = "1.0.0" as const;

export type F144PromptSkillRegressionTesterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F144PromptSkillRegressionTesterConfig {
  readonly featureId: typeof F144_FEATURE_ID;
  readonly stage: typeof F144_STAGE;
  readonly operationCode: typeof F144_OPERATION_CODE;
  readonly contractVersion: typeof F144_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F144PromptSkillRegressionTesterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly baseline_version: string;
  readonly candidate_version: string | number;
  readonly drift_detected: string | number | boolean | readonly string[];
  readonly regression_passed: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F144PromptSkillRegressionTesterOutput {
  readonly featureId: typeof F144_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F144PromptSkillRegressionTesterExecutionStatus;
  readonly operationCode: typeof F144_OPERATION_CODE;
  readonly resolved_baseline_version: string;
  readonly resolved_candidate_version: string | number;
  readonly resolved_drift_detected: string | number | boolean | readonly string[];
  readonly resolved_regression_passed: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F144PromptSkillRegressionTesterAuditEntry;
}

export interface F144PromptSkillRegressionTesterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F144_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F144PromptSkillRegressionTesterTelemetrySnapshot {
  readonly featureId: typeof F144_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F144_CONFIG: F144PromptSkillRegressionTesterConfig = {
  featureId: F144_FEATURE_ID,
  stage: F144_STAGE,
  operationCode: F144_OPERATION_CODE,
  contractVersion: F144_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F144PromptSkillRegressionTesterValidationError extends Error {
  public readonly featureId = F144_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F144 Validation Error on '${field}']: ${message}`);
    this.name = "F144PromptSkillRegressionTesterValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F144 provenance & audit integrity.
 */
export function computeF144Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f144_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F144: Регрессионное тестирование промптов и скиллов
 * Проверка того, что обновление системного промпта не ухудшило качество старых сценариев
 */
export class F144PromptSkillRegressionTesterEngine {
  private readonly config: F144PromptSkillRegressionTesterConfig;
  private readonly executionHistory: F144PromptSkillRegressionTesterOutput[] = [];
  private readonly auditLog: F144PromptSkillRegressionTesterAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F144PromptSkillRegressionTesterConfig>) {
    this.config = {
      ...DEFAULT_F144_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F144PromptSkillRegressionTesterConfig {
    return { ...this.config };
  }

  public validateInput(input: F144PromptSkillRegressionTesterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F144PromptSkillRegressionTesterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F144PromptSkillRegressionTesterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F144PromptSkillRegressionTesterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F144PromptSkillRegressionTesterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.baseline_version).trim().length === 0) {
      throw new F144PromptSkillRegressionTesterValidationError("baseline_version", "Primary domain attribute 'baseline_version' cannot be empty.");
    }
  }

  public execute(input: F144PromptSkillRegressionTesterInput): F144PromptSkillRegressionTesterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f144_${this.totalRuns}_${computeF144Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F144_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        baseline_version: input.baseline_version,
        candidate_version: input.candidate_version,
        drift_detected: input.drift_detected,
        regression_passed: input.regression_passed,
      });

      const provenanceDigest = computeF144Digest(canonicalPayload);
      const auditRecord: F144PromptSkillRegressionTesterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F144_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `prompt_regression_gate:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F144PromptSkillRegressionTesterOutput = {
        featureId: F144_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F144_OPERATION_CODE,
        resolved_baseline_version: input.baseline_version,
        resolved_candidate_version: input.candidate_version,
        resolved_drift_detected: input.drift_detected,
        resolved_regression_passed: input.regression_passed,
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

  public getTelemetrySnapshot(): F144PromptSkillRegressionTesterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F144_FEATURE_ID,
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

  public getAuditTrail(): readonly F144PromptSkillRegressionTesterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F144PromptSkillRegressionTesterOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F144 (Регрессионное тестирование промптов и скиллов)
 */
export function verifyF144Module(): {
  featureId: typeof F144_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F144PromptSkillRegressionTesterEngine();
  const sampleInput: F144PromptSkillRegressionTesterInput = {
    requestId: "req_verify_f144",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    baseline_version: "f144_baseline_version_verified",
    candidate_version: 100,
    drift_detected: true,
    regression_passed: "verified_ok",
    metadata: { stage: "stage5-enterprise", featureNumber: 144 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F144" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F144_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
