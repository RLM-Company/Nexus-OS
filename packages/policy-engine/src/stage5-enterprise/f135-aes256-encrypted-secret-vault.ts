/**
 * F135 (stage5-enterprise): Хранилище секретов и ключей (Encrypted Vault)
 * Шифрование пользовательских API-ключей и токенов интеграций (AES-256)
 * Operation Code: aes256_gcm_vault
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F135_FEATURE_ID = "F135" as const;
export const F135_STAGE = "stage5-enterprise" as const;
export const F135_OPERATION_CODE = "aes256_gcm_vault" as const;
export const F135_CONTRACT_VERSION = "2.0.0" as const;

export type F135Aes256EncryptedSecretVaultExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F135Aes256EncryptedSecretVaultConfig {
  readonly featureId: typeof F135_FEATURE_ID;
  readonly stage: typeof F135_STAGE;
  readonly operationCode: typeof F135_OPERATION_CODE;
  readonly contractVersion: typeof F135_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F135Aes256EncryptedSecretVaultInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly secret_id: string;
  readonly cipher_algorithm: string | number;
  readonly key_rotation_version: string | number | boolean | readonly string[];
  readonly authenticated_tag_valid: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F135Aes256EncryptedSecretVaultAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F135_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F135Aes256EncryptedSecretVaultOutput {
  readonly featureId: typeof F135_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F135Aes256EncryptedSecretVaultExecutionStatus;
  readonly operationCode: typeof F135_OPERATION_CODE;
  readonly resolved_secret_id: string;
  readonly resolved_cipher_algorithm: string | number;
  readonly resolved_key_rotation_version: string | number | boolean | readonly string[];
  readonly resolved_authenticated_tag_valid: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F135Aes256EncryptedSecretVaultAuditEntry;
}

export interface F135Aes256EncryptedSecretVaultTelemetrySnapshot {
  readonly featureId: typeof F135_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F135_CONFIG: F135Aes256EncryptedSecretVaultConfig = {
  featureId: F135_FEATURE_ID,
  stage: F135_STAGE,
  operationCode: F135_OPERATION_CODE,
  contractVersion: F135_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F135Aes256EncryptedSecretVaultValidationError extends Error {
  public readonly featureId = F135_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F135 Validation Error on '${field}']: ${message}`);
    this.name = "F135Aes256EncryptedSecretVaultValidationError";
    this.field = field;
  }
}

export function computeF135Digest(rawPayload: string): string {
  return `f135_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F135Aes256EncryptedSecretVaultEngine {
  private readonly config: F135Aes256EncryptedSecretVaultConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F135Aes256EncryptedSecretVaultOutput[] = [];
  private readonly auditLog: F135Aes256EncryptedSecretVaultAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F135Aes256EncryptedSecretVaultOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F135Aes256EncryptedSecretVaultConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F135_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F135Aes256EncryptedSecretVaultConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F135Aes256EncryptedSecretVaultInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F135Aes256EncryptedSecretVaultValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.secret_id).trim().length === 0) {
      throw new F135Aes256EncryptedSecretVaultValidationError("secret_id", "Primary domain attribute 'secret_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      secret_id: input.secret_id,
      cipher_algorithm: input.cipher_algorithm,
      key_rotation_version: input.key_rotation_version,
      authenticated_tag_valid: input.authenticated_tag_valid
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F135Aes256EncryptedSecretVaultValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F135Aes256EncryptedSecretVaultInput): F135Aes256EncryptedSecretVaultOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F135_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        secret_id: input.secret_id,
        cipher_algorithm: input.cipher_algorithm,
        key_rotation_version: input.key_rotation_version,
        authenticated_tag_valid: input.authenticated_tag_valid
      });
      const payloadHash = computeF135Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F135Aes256EncryptedSecretVaultValidationError(
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
        featureId: F135_FEATURE_ID,
        operationCode: F135_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          secret_id: input.secret_id,
          cipher_algorithm: input.cipher_algorithm,
          key_rotation_version: input.key_rotation_version,
          authenticated_tag_valid: input.authenticated_tag_valid
        }
      });

      const executionId = `exec_f135_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f135_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F135Aes256EncryptedSecretVaultAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F135_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `aes256_gcm_vault:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F135Aes256EncryptedSecretVaultOutput = {
        featureId: F135_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F135_OPERATION_CODE,
        resolved_secret_id: kernelResult.resolvedFields.secret_id as string,
        resolved_cipher_algorithm: kernelResult.resolvedFields.cipher_algorithm as string | number,
        resolved_key_rotation_version: kernelResult.resolvedFields.key_rotation_version as string | number | boolean | readonly string[],
        resolved_authenticated_tag_valid: kernelResult.resolvedFields.authenticated_tag_valid as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F135Aes256EncryptedSecretVaultTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F135_FEATURE_ID,
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

  public getAuditTrail(): readonly F135Aes256EncryptedSecretVaultAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F135Aes256EncryptedSecretVaultOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF135Module(): {
  featureId: typeof F135_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F135Aes256EncryptedSecretVaultEngine();
  const sampleInput: F135Aes256EncryptedSecretVaultInput = {
    requestId: "req_verify_f135",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    secret_id: "f135_secret_id_seed",
    cipher_algorithm: 42,
    key_rotation_version: true,
    authenticated_tag_valid: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 135 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F135" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_secret_id !== sampleInput.secret_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F135_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
