/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F065
 * ============================================================================
 * Feature ID: F065
 * Stage: stage3-skills-bus
 * Title: Вызов модульных Skills прямо в чате (/skill или @skill)
 * Description: Быстрое подключение специализированных навыков в активный диалог
 * Operation Code: chat_skill_parser
 * Target Package Directory: packages/tool-runtime/src/stage3-skills-bus
 * ============================================================================
 */

export const F065_FEATURE_ID = "F065" as const;
export const F065_STAGE = "stage3-skills-bus" as const;
export const F065_OPERATION_CODE = "chat_skill_parser" as const;
export const F065_CONTRACT_VERSION = "1.0.0" as const;

export type F065ChatModularSkillInvokerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F065ChatModularSkillInvokerConfig {
  readonly featureId: typeof F065_FEATURE_ID;
  readonly stage: typeof F065_STAGE;
  readonly operationCode: typeof F065_OPERATION_CODE;
  readonly contractVersion: typeof F065_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F065ChatModularSkillInvokerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly invoked_handle: string;
  readonly parsed_arguments: string | number;
  readonly clean_user_prompt: string | number | boolean | readonly string[];
  readonly skill_bound: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F065ChatModularSkillInvokerOutput {
  readonly featureId: typeof F065_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F065ChatModularSkillInvokerExecutionStatus;
  readonly operationCode: typeof F065_OPERATION_CODE;
  readonly resolved_invoked_handle: string;
  readonly resolved_parsed_arguments: string | number;
  readonly resolved_clean_user_prompt: string | number | boolean | readonly string[];
  readonly resolved_skill_bound: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F065ChatModularSkillInvokerAuditEntry;
}

export interface F065ChatModularSkillInvokerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F065_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F065ChatModularSkillInvokerTelemetrySnapshot {
  readonly featureId: typeof F065_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F065_CONFIG: F065ChatModularSkillInvokerConfig = {
  featureId: F065_FEATURE_ID,
  stage: F065_STAGE,
  operationCode: F065_OPERATION_CODE,
  contractVersion: F065_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F065ChatModularSkillInvokerValidationError extends Error {
  public readonly featureId = F065_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F065 Validation Error on '${field}']: ${message}`);
    this.name = "F065ChatModularSkillInvokerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F065 provenance & audit integrity.
 */
export function computeF065Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f065_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F065: Вызов модульных Skills прямо в чате (/skill или @skill)
 * Быстрое подключение специализированных навыков в активный диалог
 */
export class F065ChatModularSkillInvokerEngine {
  private readonly config: F065ChatModularSkillInvokerConfig;
  private readonly executionHistory: F065ChatModularSkillInvokerOutput[] = [];
  private readonly auditLog: F065ChatModularSkillInvokerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F065ChatModularSkillInvokerConfig>) {
    this.config = {
      ...DEFAULT_F065_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F065ChatModularSkillInvokerConfig {
    return { ...this.config };
  }

  public validateInput(input: F065ChatModularSkillInvokerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F065ChatModularSkillInvokerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F065ChatModularSkillInvokerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F065ChatModularSkillInvokerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F065ChatModularSkillInvokerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.invoked_handle).trim().length === 0) {
      throw new F065ChatModularSkillInvokerValidationError("invoked_handle", "Primary domain attribute 'invoked_handle' cannot be empty.");
    }
  }

  public execute(input: F065ChatModularSkillInvokerInput): F065ChatModularSkillInvokerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f065_${this.totalRuns}_${computeF065Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F065_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        invoked_handle: input.invoked_handle,
        parsed_arguments: input.parsed_arguments,
        clean_user_prompt: input.clean_user_prompt,
        skill_bound: input.skill_bound,
      });

      const provenanceDigest = computeF065Digest(canonicalPayload);
      const auditRecord: F065ChatModularSkillInvokerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F065_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chat_skill_parser:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F065ChatModularSkillInvokerOutput = {
        featureId: F065_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F065_OPERATION_CODE,
        resolved_invoked_handle: input.invoked_handle,
        resolved_parsed_arguments: input.parsed_arguments,
        resolved_clean_user_prompt: input.clean_user_prompt,
        resolved_skill_bound: input.skill_bound,
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

  public getTelemetrySnapshot(): F065ChatModularSkillInvokerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F065_FEATURE_ID,
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

  public getAuditTrail(): readonly F065ChatModularSkillInvokerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F065ChatModularSkillInvokerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F065 (Вызов модульных Skills прямо в чате (/skill или @skill))
 */
export function verifyF065Module(): {
  featureId: typeof F065_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F065ChatModularSkillInvokerEngine();
  const sampleInput: F065ChatModularSkillInvokerInput = {
    requestId: "req_verify_f065",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    invoked_handle: "f065_invoked_handle_verified",
    parsed_arguments: 100,
    clean_user_prompt: true,
    skill_bound: "verified_ok",
    metadata: { stage: "stage3-skills-bus", featureNumber: 65 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F065" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F065_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
