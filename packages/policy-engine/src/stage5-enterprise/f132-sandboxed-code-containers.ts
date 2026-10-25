/**
 * F132 (stage5-enterprise): Изолированные песочницы выполнения кода (Sandboxed Node/Python Containers)
 * Запуск агентских скриптов без доступа к хост-системе и чужим сетям
 * Operation Code: container_sandbox_policy
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F132_FEATURE_ID = "F132" as const;
export const F132_STAGE = "stage5-enterprise" as const;
export const F132_OPERATION_CODE = "container_sandbox_policy" as const;
export const F132_CONTRACT_VERSION = "2.0.0" as const;

export type F132SandboxedCodeContainersExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F132SandboxedCodeContainersConfig {
  readonly featureId: typeof F132_FEATURE_ID;
  readonly stage: typeof F132_STAGE;
  readonly operationCode: typeof F132_OPERATION_CODE;
  readonly contractVersion: typeof F132_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F132SandboxedCodeContainersInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly container_id: string;
  readonly runtime_image: string | number;
  readonly network_egress_blocked: string | number | boolean | readonly string[];
  readonly seccomp_profile: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F132SandboxedCodeContainersAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F132_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F132SandboxedCodeContainersOutput {
  readonly featureId: typeof F132_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F132SandboxedCodeContainersExecutionStatus;
  readonly operationCode: typeof F132_OPERATION_CODE;
  readonly resolved_container_id: string;
  readonly resolved_runtime_image: string | number;
  readonly resolved_network_egress_blocked: string | number | boolean | readonly string[];
  readonly resolved_seccomp_profile: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F132SandboxedCodeContainersAuditEntry;
}

export interface F132SandboxedCodeContainersTelemetrySnapshot {
  readonly featureId: typeof F132_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F132_CONFIG: F132SandboxedCodeContainersConfig = {
  featureId: F132_FEATURE_ID,
  stage: F132_STAGE,
  operationCode: F132_OPERATION_CODE,
  contractVersion: F132_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F132SandboxedCodeContainersValidationError extends Error {
  public readonly featureId = F132_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F132 Validation Error on '${field}']: ${message}`);
    this.name = "F132SandboxedCodeContainersValidationError";
    this.field = field;
  }
}

export function computeF132Digest(rawPayload: string): string {
  return `f132_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F132SandboxedCodeContainersEngine {
  private readonly config: F132SandboxedCodeContainersConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F132SandboxedCodeContainersOutput[] = [];
  private readonly auditLog: F132SandboxedCodeContainersAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F132SandboxedCodeContainersOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F132SandboxedCodeContainersConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F132_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F132SandboxedCodeContainersConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F132SandboxedCodeContainersInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F132SandboxedCodeContainersValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.container_id).trim().length === 0) {
      throw new F132SandboxedCodeContainersValidationError("container_id", "Primary domain attribute 'container_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      container_id: input.container_id,
      runtime_image: input.runtime_image,
      network_egress_blocked: input.network_egress_blocked,
      seccomp_profile: input.seccomp_profile
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F132SandboxedCodeContainersValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F132SandboxedCodeContainersInput): F132SandboxedCodeContainersOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F132_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        container_id: input.container_id,
        runtime_image: input.runtime_image,
        network_egress_blocked: input.network_egress_blocked,
        seccomp_profile: input.seccomp_profile
      });
      const payloadHash = computeF132Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F132SandboxedCodeContainersValidationError(
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
        featureId: F132_FEATURE_ID,
        operationCode: F132_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          container_id: input.container_id,
          runtime_image: input.runtime_image,
          network_egress_blocked: input.network_egress_blocked,
          seccomp_profile: input.seccomp_profile
        }
      });

      const executionId = `exec_f132_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f132_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F132SandboxedCodeContainersAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F132_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `container_sandbox_policy:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F132SandboxedCodeContainersOutput = {
        featureId: F132_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F132_OPERATION_CODE,
        resolved_container_id: kernelResult.resolvedFields.container_id as string,
        resolved_runtime_image: kernelResult.resolvedFields.runtime_image as string | number,
        resolved_network_egress_blocked: kernelResult.resolvedFields.network_egress_blocked as string | number | boolean | readonly string[],
        resolved_seccomp_profile: kernelResult.resolvedFields.seccomp_profile as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F132SandboxedCodeContainersTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F132_FEATURE_ID,
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

  public getAuditTrail(): readonly F132SandboxedCodeContainersAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F132SandboxedCodeContainersOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF132Module(): {
  featureId: typeof F132_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F132SandboxedCodeContainersEngine();
  const sampleInput: F132SandboxedCodeContainersInput = {
    requestId: "req_verify_f132",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    container_id: "f132_container_id_seed",
    runtime_image: 42,
    network_egress_blocked: true,
    seccomp_profile: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 132 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F132" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_container_id !== sampleInput.container_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F132_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
