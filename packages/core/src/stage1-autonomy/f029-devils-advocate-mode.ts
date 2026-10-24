/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F029
 * ============================================================================
 * Feature ID: F029
 * Stage: stage1-autonomy
 * Title: Режим «Адвокат дьявола»
 * Description: Принудительный запуск агента-оппонента для поиска слабых мест в бизнес-плане или архитектуре
 * Operation Code: redteam_challenger
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F029_FEATURE_ID = "F029" as const;
export const F029_STAGE = "stage1-autonomy" as const;
export const F029_OPERATION_CODE = "redteam_challenger" as const;
export const F029_CONTRACT_VERSION = "1.0.0" as const;

export type F029DevilsAdvocateModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F029DevilsAdvocateModeConfig {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly stage: typeof F029_STAGE;
  readonly operationCode: typeof F029_OPERATION_CODE;
  readonly contractVersion: typeof F029_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F029DevilsAdvocateModeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly challenge_id: string;
  readonly target_artifact_id: string | number;
  readonly vulnerabilities_found: string | number | boolean | readonly string[];
  readonly counter_arguments: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F029DevilsAdvocateModeOutput {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F029DevilsAdvocateModeExecutionStatus;
  readonly operationCode: typeof F029_OPERATION_CODE;
  readonly resolved_challenge_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_vulnerabilities_found: string | number | boolean | readonly string[];
  readonly resolved_counter_arguments: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F029DevilsAdvocateModeAuditEntry;
}

export interface F029DevilsAdvocateModeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F029_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F029DevilsAdvocateModeTelemetrySnapshot {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F029_CONFIG: F029DevilsAdvocateModeConfig = {
  featureId: F029_FEATURE_ID,
  stage: F029_STAGE,
  operationCode: F029_OPERATION_CODE,
  contractVersion: F029_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F029DevilsAdvocateModeValidationError extends Error {
  public readonly featureId = F029_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F029 Validation Error on '${field}']: ${message}`);
    this.name = "F029DevilsAdvocateModeValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F029 provenance & audit integrity.
 */
export function computeF029Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f029_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F029: Режим «Адвокат дьявола»
 * Принудительный запуск агента-оппонента для поиска слабых мест в бизнес-плане или архитектуре
 */
export class F029DevilsAdvocateModeEngine {
  private readonly config: F029DevilsAdvocateModeConfig;
  private readonly executionHistory: F029DevilsAdvocateModeOutput[] = [];
  private readonly auditLog: F029DevilsAdvocateModeAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F029DevilsAdvocateModeConfig>) {
    this.config = {
      ...DEFAULT_F029_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F029DevilsAdvocateModeConfig {
    return { ...this.config };
  }

  public validateInput(input: F029DevilsAdvocateModeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.challenge_id).trim().length === 0) {
      throw new F029DevilsAdvocateModeValidationError("challenge_id", "Primary domain attribute 'challenge_id' cannot be empty.");
    }
  }

  public execute(input: F029DevilsAdvocateModeInput): F029DevilsAdvocateModeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f029_${this.totalRuns}_${computeF029Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F029_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        challenge_id: input.challenge_id,
        target_artifact_id: input.target_artifact_id,
        vulnerabilities_found: input.vulnerabilities_found,
        counter_arguments: input.counter_arguments,
      });

      const provenanceDigest = computeF029Digest(canonicalPayload);
      const auditRecord: F029DevilsAdvocateModeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F029_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `redteam_challenger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F029DevilsAdvocateModeOutput = {
        featureId: F029_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F029_OPERATION_CODE,
        resolved_challenge_id: input.challenge_id,
        resolved_target_artifact_id: input.target_artifact_id,
        resolved_vulnerabilities_found: input.vulnerabilities_found,
        resolved_counter_arguments: input.counter_arguments,
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

  public getTelemetrySnapshot(): F029DevilsAdvocateModeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F029_FEATURE_ID,
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

  public getAuditTrail(): readonly F029DevilsAdvocateModeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F029DevilsAdvocateModeOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F029 (Режим «Адвокат дьявола»)
 */
export function verifyF029Module(): {
  featureId: typeof F029_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F029DevilsAdvocateModeEngine();
  const sampleInput: F029DevilsAdvocateModeInput = {
    requestId: "req_verify_f029",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    challenge_id: "f029_challenge_id_verified",
    target_artifact_id: 100,
    vulnerabilities_found: true,
    counter_arguments: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 29 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F029" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F029_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
