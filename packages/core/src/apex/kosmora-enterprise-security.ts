/**
 * Kosmora Stage 5 (F129-F160): Enterprise Governance, Security, Compliance & Monetization
 * Implements cryptographic session verification, RBAC/RLS isolation, AES-256-GCM Vault with
 * key rotation and tamper rejection, immutable hash-chained audit logs with full field
 * verification, strict atomic FinOps billing metering, and 3-state signed webhooks.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import type { KosmoraRole } from "./kosmora-protocol.js";

export type EnterprisePermission =
  | "workspace:read"
  | "workspace:write"
  | "dag:execute"
  | "dag:approve_hitl"
  | "canvas:export"
  | "connector:manage"
  | "vault:manage_secrets"
  | "audit:export"
  | "billing:admin";

export interface TenantPrincipal {
  user_id: string;
  tenant_id: string;
  workspace_ids: string[];
  role: KosmoraRole;
  mfa_verified: boolean;
}

export interface SignedSessionToken {
  token: string;
  user_id: string;
  tenant_id: string;
  workspace_ids: string[];
  role: KosmoraRole;
  mfa_verified: boolean;
  issued_at: string;
  expires_at: string;
}

export interface EncryptedSecretRecord {
  secret_id: string;
  tenant_id: string;
  key_name: string;
  key_version: number;
  cipher_algorithm: "aes-256-gcm";
  iv_hex: string;
  auth_tag_hex: string;
  ciphertext_hex: string;
  rotated_at: string;
  created_by: string;
}

export interface AuditLogEntry {
  readonly entry_id: string;
  readonly sequence_number: number;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly action: string;
  readonly resource_uri: string;
  readonly decision: "allow" | "deny";
  readonly metadata_redacted: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly content_sha256: string;
  readonly prev_hash: string;
  readonly entry_hash: string;
}

export interface TenantBillingLedger {
  tenant_id: string;
  plan_tier: "pro" | "team" | "enterprise" | "sovereign";
  included_monthly_tokens: number;
  consumed_tokens: number;
  overage_rate_per_1k_usd: number;
  accrued_spend_usd: number;
  hard_limit_usd: number;
  hard_stop_enforced: boolean;
}

export type WebhookLifecycleStatus =
  "created" | "delivery_attempted" | "delivered_confirmed" | "failed";

export interface SignedWebhookDelivery {
  delivery_id: string;
  event_type: string;
  target_url: string;
  payload_json: string;
  signature_sha256: string;
  timestamp: number;
  status: WebhookLifecycleStatus;
  delivered: boolean;
  http_status?: number;
  response_excerpt?: string;
  error_reason?: string;
}

export type WebhookHttpTransport = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const ROLE_PERMISSIONS: Record<KosmoraRole, EnterprisePermission[]> = {
  owner: [
    "workspace:read",
    "workspace:write",
    "dag:execute",
    "dag:approve_hitl",
    "canvas:export",
    "connector:manage",
    "vault:manage_secrets",
    "audit:export",
    "billing:admin"
  ],
  admin: [
    "workspace:read",
    "workspace:write",
    "dag:execute",
    "dag:approve_hitl",
    "canvas:export",
    "connector:manage",
    "vault:manage_secrets",
    "audit:export"
  ],
  operator: [
    "workspace:read",
    "workspace:write",
    "dag:execute",
    "dag:approve_hitl",
    "canvas:export"
  ],
  analyst: ["workspace:read", "workspace:write", "dag:execute", "canvas:export"],
  auditor: ["workspace:read", "audit:export"],
  viewer: ["workspace:read"]
};

const SENSITIVE_KEY_PATTERN =
  /(secret|password|passwd|token|api_key|apikey|private_key|authorization|credential|master_key|ciphertext)/i;

export class KosmoraEnterpriseSecurityEngine {
  private masterKey: Buffer;
  private currentKeyVersion = 1;
  private readonly keyRing = new Map<number, Buffer>();
  private readonly sessionSigningKey: Buffer;
  private readonly registeredPrincipals = new Map<string, TenantPrincipal>();
  private readonly vault = new Map<string, EncryptedSecretRecord>();
  private readonly auditChain: AuditLogEntry[] = [];
  private readonly billingLedgers = new Map<string, TenantBillingLedger>();
  private readonly webhookDeliveries = new Map<string, SignedWebhookDelivery>();

  constructor(masterKeyHex?: string) {
    const configured = masterKeyHex ?? process.env.KOSMORA_ENTERPRISE_MASTER_KEY;
    if (!configured || !/^[a-f0-9]{64}$/i.test(configured)) {
      throw new Error("ENTERPRISE_MASTER_KEY_REQUIRED: configure an explicit 32-byte hex key");
    }
    this.masterKey = Buffer.from(configured, "hex");
    this.keyRing.set(this.currentKeyVersion, Buffer.from(this.masterKey));
    this.sessionSigningKey = createHash("sha256")
      .update(Buffer.concat([this.masterKey, Buffer.from(":session-hmac-v1")]))
      .digest();
  }

  /**
   * Register a verified principal in the enterprise directory and issue a signed session token.
   */
  public issueSignedSessionToken(
    principal: TenantPrincipal,
    ttlSeconds = 3600
  ): SignedSessionToken {
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > 30 * 86400 ||
      !Object.hasOwn(ROLE_PERMISSIONS, principal.role) ||
      typeof principal.mfa_verified !== "boolean" ||
      !Array.isArray(principal.workspace_ids) ||
      !principal.workspace_ids.every((w) => typeof w === "string" && w.length > 0)
    )
      throw Error("INVALID_SESSION_PRINCIPAL");
    if (!principal.user_id || !principal.tenant_id) {
      throw new Error("Principal requires non-empty user_id and tenant_id");
    }
    this.registeredPrincipals.set(`${principal.tenant_id}:${principal.user_id}`, {
      ...principal,
      workspace_ids: [...principal.workspace_ids]
    });

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + Math.max(1, ttlSeconds) * 1000);
    const payloadObj = {
      user_id: principal.user_id,
      tenant_id: principal.tenant_id,
      workspace_ids: principal.workspace_ids,
      role: principal.role,
      mfa_verified: principal.mfa_verified,
      iat: issuedAt.toISOString(),
      exp: expiresAt.toISOString()
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
    const sigBase64 = createHmac("sha256", this.sessionSigningKey)
      .update(payloadBase64)
      .digest("base64url");

    return {
      token: `ksm_sess.${payloadBase64}.${sigBase64}`,
      user_id: principal.user_id,
      tenant_id: principal.tenant_id,
      workspace_ids: [...principal.workspace_ids],
      role: principal.role,
      mfa_verified: principal.mfa_verified,
      issued_at: payloadObj.iat,
      expires_at: payloadObj.exp
    };
  }

  /**
   * Verify a cryptographically signed session token and return the authenticated principal.
   * Rejects forged, tampered, or expired tokens.
   */
  public verifySignedSessionToken(token: string, now = new Date()): TenantPrincipal {
    if (typeof token !== "string" || token.length > 16384)
      throw Error("Invalid session token format");
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "ksm_sess") {
      throw new Error("Invalid session token format");
    }
    const payloadBase64 = parts[1]!;
    const providedSig = parts[2]!;
    const expectedSig = createHmac("sha256", this.sessionSigningKey)
      .update(payloadBase64)
      .digest("base64url");

    const a = Buffer.from(providedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Session token signature verification failed");
    }

    const decoded = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as {
      user_id: string;
      tenant_id: string;
      workspace_ids: string[];
      role: KosmoraRole;
      mfa_verified: boolean;
      exp: string;
    };

    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.user_id !== "string" ||
      !decoded.user_id ||
      typeof decoded.tenant_id !== "string" ||
      !decoded.tenant_id ||
      !Array.isArray(decoded.workspace_ids) ||
      !decoded.workspace_ids.every((w) => typeof w === "string" && w.length > 0) ||
      !Object.hasOwn(ROLE_PERMISSIONS, decoded.role) ||
      typeof decoded.mfa_verified !== "boolean" ||
      typeof decoded.exp !== "string" ||
      !Number.isFinite(Date.parse(decoded.exp)) ||
      !Number.isFinite(now.getTime())
    ) {
      throw new Error("Invalid session token claims");
    }
    if (new Date(decoded.exp).getTime() <= now.getTime()) {
      throw new Error("Session token has expired");
    }
    const registered = this.registeredPrincipals.get(`${decoded.tenant_id}:${decoded.user_id}`);
    if (
      !registered ||
      registered.role !== decoded.role ||
      registered.mfa_verified !== decoded.mfa_verified ||
      JSON.stringify([...registered.workspace_ids].sort()) !==
        JSON.stringify([...decoded.workspace_ids].sort())
    )
      throw Error("UNREGISTERED_OR_CHANGED_PRINCIPAL");

    return {
      user_id: decoded.user_id,
      tenant_id: decoded.tenant_id,
      workspace_ids: decoded.workspace_ids,
      role: decoded.role,
      mfa_verified: decoded.mfa_verified
    };
  }

  /**
   * Authenticate a signed session token AND authorize against tenant/workspace/permission boundaries.
   */
  public authenticateAndAuthorize(
    sessionToken: string,
    targetTenantId: string,
    targetWorkspaceId: string,
    requiredPermission: EnterprisePermission
  ): { allowed: boolean; reason: string; principal?: TenantPrincipal } {
    let principal: TenantPrincipal;
    try {
      principal = this.verifySignedSessionToken(sessionToken);
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : "Invalid session token"
      };
    }
    const decision = this.authorizeAction(
      principal,
      targetTenantId,
      targetWorkspaceId,
      requiredPermission
    );
    return {
      ...decision,
      principal
    };
  }

  /**
   * F129, F130: Multi-Tenant RBAC, ABAC & Row-Level Security (RLS) Authorization Check
   */
  public authorizeAction(
    principal: TenantPrincipal,
    targetTenantId: string,
    targetWorkspaceId: string,
    requiredPermission: EnterprisePermission
  ): { allowed: boolean; reason: string } {
    // If the tenant has registered principals in the directory, verify that the caller's role
    // and MFA status match the authoritative directory record rather than trusting self-asserted claims.
    const directoryKey = `${principal.tenant_id}:${principal.user_id}`;
    const authoritative = this.registeredPrincipals.get(directoryKey);
    if (!authoritative) return { allowed: false, reason: "UNREGISTERED_PRINCIPAL" };
    const effectivePrincipal = authoritative;

    if (effectivePrincipal.tenant_id !== targetTenantId) {
      this.appendAuditEntry(
        effectivePrincipal.tenant_id,
        effectivePrincipal.user_id,
        `authz:${requiredPermission}`,
        `tenant://${targetTenantId}/workspace/${targetWorkspaceId}`,
        "deny",
        { reason: "cross_tenant_rls_violation", target_tenant_id: targetTenantId }
      );
      return {
        allowed: false,
        reason: `RLS Violation: Principal tenant '${effectivePrincipal.tenant_id}' cannot access tenant '${targetTenantId}'.`
      };
    }

    if (!effectivePrincipal.workspace_ids.includes(targetWorkspaceId)) {
      this.appendAuditEntry(
        targetTenantId,
        effectivePrincipal.user_id,
        `authz:${requiredPermission}`,
        `tenant://${targetTenantId}/workspace/${targetWorkspaceId}`,
        "deny",
        { reason: "workspace_isolation_violation" }
      );
      return {
        allowed: false,
        reason: `Workspace Isolation: User '${effectivePrincipal.user_id}' is not granted access to workspace '${targetWorkspaceId}'.`
      };
    }

    const granted = ROLE_PERMISSIONS[effectivePrincipal.role] ?? [];
    if (!granted.includes(requiredPermission)) {
      this.appendAuditEntry(
        targetTenantId,
        effectivePrincipal.user_id,
        `authz:${requiredPermission}`,
        `tenant://${targetTenantId}/workspace/${targetWorkspaceId}`,
        "deny",
        { reason: "insufficient_role_permission", role: effectivePrincipal.role }
      );
      return {
        allowed: false,
        reason: `RBAC Denied: Role '${effectivePrincipal.role}' lacks permission '${requiredPermission}'.`
      };
    }

    if (
      (requiredPermission === "vault:manage_secrets" || requiredPermission === "billing:admin") &&
      !effectivePrincipal.mfa_verified
    ) {
      this.appendAuditEntry(
        targetTenantId,
        effectivePrincipal.user_id,
        `authz:${requiredPermission}`,
        `tenant://${targetTenantId}/workspace/${targetWorkspaceId}`,
        "deny",
        { reason: "mfa_step_up_required" }
      );
      return {
        allowed: false,
        reason: `Step-Up Auth Required: Permission '${requiredPermission}' requires MFA verification.`
      };
    }

    this.appendAuditEntry(
      targetTenantId,
      effectivePrincipal.user_id,
      `authz:${requiredPermission}`,
      `tenant://${targetTenantId}/workspace/${targetWorkspaceId}`,
      "allow",
      { role: effectivePrincipal.role, workspace_id: targetWorkspaceId }
    );

    return { allowed: true, reason: "Authorized by RBAC + RLS policy" };
  }

  /**
   * F132: AES-256-GCM Secret Vault Encryption, Decryption & Key Rotation.
   * Secrets are never stored in plaintext or leaked into audit logs.
   */
  public storeEncryptedSecret(
    tenantId: string,
    keyName: string,
    plaintextValue: string,
    actorId = "system"
  ): EncryptedSecretRecord {
    if (!tenantId || !keyName || !plaintextValue) {
      throw new Error(
        "storeEncryptedSecret requires non-empty tenantId, keyName, and plaintextValue"
      );
    }

    const iv = randomBytes(12);
    const activeKey = this.keyRing.get(this.currentKeyVersion) ?? this.masterKey;
    const cipher = createCipheriv("aes-256-gcm", activeKey, iv);
    cipher.setAAD(Buffer.from(`${tenantId}:${keyName}:v${this.currentKeyVersion}`, "utf8"));

    const encrypted = Buffer.concat([cipher.update(plaintextValue, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const record: EncryptedSecretRecord = {
      secret_id: `sec_${tenantId}_${keyName}`,
      tenant_id: tenantId,
      key_name: keyName,
      key_version: this.currentKeyVersion,
      cipher_algorithm: "aes-256-gcm",
      iv_hex: iv.toString("hex"),
      auth_tag_hex: authTag.toString("hex"),
      ciphertext_hex: encrypted.toString("hex"),
      rotated_at: new Date().toISOString(),
      created_by: actorId
    };

    this.vault.set(record.secret_id, { ...record });
    this.appendAuditEntry(
      tenantId,
      actorId,
      "vault:store_secret",
      `vault://${tenantId}/${keyName}`,
      "allow",
      {
        secret_id: record.secret_id,
        key_name: keyName,
        key_version: record.key_version,
        cipher_algorithm: record.cipher_algorithm
      }
    );

    return { ...record };
  }

  public decryptSecret(secretId: string, requestingTenantId: string): string {
    const record = this.vault.get(secretId);
    if (!record) {
      throw new Error(`Secret '${secretId}' not found in vault`);
    }
    if (record.tenant_id !== requestingTenantId) {
      throw new Error("RLS Violation: Cross-tenant secret decryption blocked");
    }

    const decryptionKey = this.keyRing.get(record.key_version);
    if (!decryptionKey) {
      throw new Error(`Vault key version v${record.key_version} is unavailable`);
    }

    const iv = Buffer.from(record.iv_hex, "hex");
    const authTag = Buffer.from(record.auth_tag_hex, "hex");
    const ciphertext = Buffer.from(record.ciphertext_hex, "hex");

    if (iv.length !== 12 || authTag.length !== 16) {
      throw new Error("Vault integrity failure: invalid IV or authentication tag length");
    }

    const decipher = createDecipheriv("aes-256-gcm", decryptionKey, iv);
    decipher.setAAD(
      Buffer.from(`${record.tenant_id}:${record.key_name}:v${record.key_version}`, "utf8")
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /**
   * Rotate the Vault master key and re-encrypt all stored tenant secrets under the new key version.
   */
  public rotateVaultMasterKey(newMasterKeyHex?: string): {
    previous_key_version: number;
    new_key_version: number;
    reencrypted_secrets_count: number;
  } {
    const prevVersion = this.currentKeyVersion;
    const nextVersion = prevVersion + 1;
    if (newMasterKeyHex !== undefined && !/^[a-f0-9]{64}$/i.test(newMasterKeyHex)) {
      throw new Error("ENTERPRISE_MASTER_KEY_INVALID");
    }
    const nextKey = newMasterKeyHex ? Buffer.from(newMasterKeyHex, "hex") : randomBytes(32);

    this.keyRing.set(nextVersion, nextKey);
    this.masterKey = nextKey;
    this.currentKeyVersion = nextVersion;

    let count = 0;
    for (const [secretId, record] of this.vault.entries()) {
      // Decrypt with old key version and re-encrypt with new key version
      const oldKey = this.keyRing.get(record.key_version)!;
      const decipher = createDecipheriv("aes-256-gcm", oldKey, Buffer.from(record.iv_hex, "hex"));
      decipher.setAAD(
        Buffer.from(`${record.tenant_id}:${record.key_name}:v${record.key_version}`, "utf8")
      );
      decipher.setAuthTag(Buffer.from(record.auth_tag_hex, "hex"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext_hex, "hex")),
        decipher.final()
      ]).toString("utf8");

      const newIv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", nextKey, newIv);
      cipher.setAAD(Buffer.from(`${record.tenant_id}:${record.key_name}:v${nextVersion}`, "utf8"));
      const newCiphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const newTag = cipher.getAuthTag();

      this.vault.set(secretId, {
        ...record,
        key_version: nextVersion,
        iv_hex: newIv.toString("hex"),
        auth_tag_hex: newTag.toString("hex"),
        ciphertext_hex: newCiphertext.toString("hex"),
        rotated_at: new Date().toISOString()
      });
      count += 1;
    }

    return {
      previous_key_version: prevVersion,
      new_key_version: nextVersion,
      reencrypted_secrets_count: count
    };
  }

  /**
   * Redact sensitive keys and secret patterns from diagnostic metadata before logging.
   */
  public redactSensitiveMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        redacted[key] = "[REDACTED_SECRET]";
      } else if (typeof value === "string" && /^(ghp_|sk-|ksm_sess\.|eyJ)/.test(value)) {
        redacted[key] = "[REDACTED_TOKEN]";
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        redacted[key] = this.redactSensitiveMetadata(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }
    return Object.freeze(redacted);
  }

  /**
   * F133: Immutable Cryptographic Hash-Chained Audit Trail (SOC2 / ISO27001)
   * Every entry is frozen and hashes its full content so any mutation, deletion, or reordering is caught.
   */
  public appendAuditEntry(
    tenantId: string,
    actorId: string,
    action: string,
    resourceUri: string,
    decision: "allow" | "deny",
    metadata: Record<string, unknown> = {}
  ): AuditLogEntry {
    const sequenceNumber = this.auditChain.length + 1;
    const prevHash =
      this.auditChain.length > 0
        ? this.auditChain[this.auditChain.length - 1]!.entry_hash
        : "0".repeat(64);
    const timestamp = new Date().toISOString();
    const entryId = `aud_${sequenceNumber}_${createHash("sha256")
      .update(`${tenantId}:${actorId}:${action}:${timestamp}:${sequenceNumber}`)
      .digest("hex")
      .slice(0, 10)}`;
    const redactedMetadata = this.redactSensitiveMetadata(metadata);

    const contentSha256 = this.computeAuditContentHash({
      entry_id: entryId,
      sequence_number: sequenceNumber,
      tenant_id: tenantId,
      actor_id: actorId,
      action,
      resource_uri: resourceUri,
      decision,
      metadata_redacted: redactedMetadata,
      timestamp
    });

    const entryHash = createHash("sha256").update(`${prevHash}:${contentSha256}`).digest("hex");

    const entry: AuditLogEntry = Object.freeze({
      entry_id: entryId,
      sequence_number: sequenceNumber,
      tenant_id: tenantId,
      actor_id: actorId,
      action,
      resource_uri: resourceUri,
      decision,
      metadata_redacted: redactedMetadata,
      timestamp,
      content_sha256: contentSha256,
      prev_hash: prevHash,
      entry_hash: entryHash
    });

    this.auditChain.push(entry);
    return entry;
  }

  /**
   * Recomputes both content_sha256 and entry_hash across the entire audit chain and checks sequence continuity.
   */
  public verifyAuditTrailIntegrity(): {
    valid: boolean;
    entries_verified: number;
    tampered_entry_id?: string;
    reason?: string;
  } {
    let expectedPrevHash = "0".repeat(64);
    for (let i = 0; i < this.auditChain.length; i++) {
      const entry = this.auditChain[i]!;
      if (entry.sequence_number !== i + 1) {
        return {
          valid: false,
          entries_verified: i,
          tampered_entry_id: entry.entry_id,
          reason: `Sequence number discontinuity at index ${i}: expected ${i + 1}, found ${entry.sequence_number}`
        };
      }
      if (entry.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          entries_verified: i,
          tampered_entry_id: entry.entry_id,
          reason: "Previous hash link mismatch"
        };
      }

      const recomputedContentHash = this.computeAuditContentHash({
        entry_id: entry.entry_id,
        sequence_number: entry.sequence_number,
        tenant_id: entry.tenant_id,
        actor_id: entry.actor_id,
        action: entry.action,
        resource_uri: entry.resource_uri,
        decision: entry.decision,
        metadata_redacted: entry.metadata_redacted,
        timestamp: entry.timestamp
      });

      if (recomputedContentHash !== entry.content_sha256) {
        return {
          valid: false,
          entries_verified: i,
          tampered_entry_id: entry.entry_id,
          reason: "Entry field content hash mismatch (payload mutated)"
        };
      }

      const recomputedEntryHash = createHash("sha256")
        .update(`${entry.prev_hash}:${recomputedContentHash}`)
        .digest("hex");

      if (recomputedEntryHash !== entry.entry_hash) {
        return {
          valid: false,
          entries_verified: i,
          tampered_entry_id: entry.entry_id,
          reason: "Entry chain hash mismatch"
        };
      }

      expectedPrevHash = entry.entry_hash;
    }
    return { valid: true, entries_verified: this.auditChain.length };
  }

  public getAuditChain(): ReadonlyArray<AuditLogEntry> {
    return [...this.auditChain];
  }

  private computeAuditContentHash(fields: {
    entry_id: string;
    sequence_number: number;
    tenant_id: string;
    actor_id: string;
    action: string;
    resource_uri: string;
    decision: "allow" | "deny";
    metadata_redacted: Readonly<Record<string, unknown>>;
    timestamp: string;
  }): string {
    const canonical = JSON.stringify({
      entry_id: fields.entry_id,
      sequence_number: fields.sequence_number,
      tenant_id: fields.tenant_id,
      actor_id: fields.actor_id,
      action: fields.action,
      resource_uri: fields.resource_uri,
      decision: fields.decision,
      metadata_redacted: fields.metadata_redacted,
      timestamp: fields.timestamp
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * F145-F148: SaaS Token Metering, Overage Calculation & Atomic Hard Budget Stop
   */
  public configureTenantBilling(ledger: TenantBillingLedger): void {
    if (
      !Number.isFinite(ledger.included_monthly_tokens) ||
      ledger.included_monthly_tokens < 0 ||
      !Number.isFinite(ledger.hard_limit_usd) ||
      ledger.hard_limit_usd < 0
    ) {
      throw new Error(
        "Invalid billing ledger configuration: limits must be non-negative finite numbers"
      );
    }
    this.billingLedgers.set(ledger.tenant_id, { ...ledger });
  }

  public meterTenantTokenUsage(
    tenantId: string,
    tokens: number,
    costUsd?: number
  ): {
    allowed: boolean;
    ledger: TenantBillingLedger;
    reason?: string;
  } {
    const ledger = this.billingLedgers.get(tenantId);
    if (!ledger) {
      throw new Error(`Billing ledger not configured for tenant '${tenantId}'`);
    }

    // Strict input validation BEFORE any state mutation (Fixes PR #380 Blocker 5)
    if (
      typeof tokens !== "number" ||
      !Number.isFinite(tokens) ||
      Number.isNaN(tokens) ||
      !Number.isInteger(tokens) ||
      tokens <= 0
    ) {
      throw new Error(
        `Invalid token usage amount '${String(tokens)}': tokens must be a positive finite integer`
      );
    }

    if (
      costUsd !== undefined &&
      (typeof costUsd !== "number" ||
        !Number.isFinite(costUsd) ||
        Number.isNaN(costUsd) ||
        costUsd < 0)
    ) {
      throw new Error(
        `Invalid explicit costUsd '${String(costUsd)}': must be a non-negative finite number`
      );
    }

    const projectedTokens = ledger.consumed_tokens + tokens;
    const prevOverageTokens = Math.max(0, ledger.consumed_tokens - ledger.included_monthly_tokens);
    const nextOverageTokens = Math.max(0, projectedTokens - ledger.included_monthly_tokens);
    const incrementalOverageTokens = nextOverageTokens - prevOverageTokens;
    const incrementalCostUsd =
      costUsd !== undefined
        ? costUsd
        : (incrementalOverageTokens / 1000) * ledger.overage_rate_per_1k_usd;
    const projectedSpendUsd = Number((ledger.accrued_spend_usd + incrementalCostUsd).toFixed(4));

    if (ledger.hard_stop_enforced && projectedSpendUsd > ledger.hard_limit_usd) {
      // Atomic rejection: do NOT mutate consumed_tokens or accrued_spend_usd
      return {
        allowed: false,
        ledger: { ...ledger },
        reason: `Tenant '${tenantId}' reached hard spend cap ($${ledger.hard_limit_usd.toFixed(2)}). Projected spend: $${projectedSpendUsd.toFixed(4)}`
      };
    }

    ledger.consumed_tokens = projectedTokens;
    ledger.accrued_spend_usd = projectedSpendUsd;
    return {
      allowed: true,
      ledger: { ...ledger }
    };
  }

  /**
   * F151: HMAC-SHA256 Signed Webhook Event Preparation & Verification
   * Separates local signature creation ("created") from actual HTTP delivery ("delivery_attempted" / "delivered_confirmed" / "failed").
   */
  public dispatchSignedWebhook(
    eventType: string,
    targetUrl: string,
    payload: Record<string, unknown>,
    webhookSecret: string
  ): SignedWebhookDelivery {
    if (!webhookSecret || webhookSecret.trim().length === 0) {
      throw new Error("webhookSecret is required to sign webhook payload");
    }
    const timestamp = Date.now();
    const payloadJson = JSON.stringify(payload);
    const signingInput = `${timestamp}.${payloadJson}`;
    const signature = createHmac("sha256", webhookSecret).update(signingInput).digest("hex");

    const delivery: SignedWebhookDelivery = {
      delivery_id: `wh_${timestamp}_${createHash("sha256").update(signingInput).digest("hex").slice(0, 8)}`,
      event_type: eventType,
      target_url: targetUrl,
      payload_json: payloadJson,
      signature_sha256: `v1=${signature}`,
      timestamp,
      status: "created",
      delivered: false
    };

    this.webhookDeliveries.set(delivery.delivery_id, delivery);
    return { ...delivery };
  }

  /**
   * Execute actual HTTP delivery of a signed webhook through a configured HTTP transport.
   * Transitions status: created -> delivery_attempted -> delivered_confirmed | failed.
   */
  public async deliverSignedWebhook(
    delivery: SignedWebhookDelivery,
    transport: WebhookHttpTransport
  ): Promise<SignedWebhookDelivery> {
    const attemptState: SignedWebhookDelivery = {
      ...delivery,
      status: "delivery_attempted",
      delivered: false
    };
    this.webhookDeliveries.set(delivery.delivery_id, attemptState);

    try {
      const response = await transport(delivery.target_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kosmora-Event": delivery.event_type,
          "X-Kosmora-Timestamp": String(delivery.timestamp),
          "X-Kosmora-Signature-256": delivery.signature_sha256
        },
        body: delivery.payload_json
      });

      const bodyText = await response.text().catch(() => "");
      if (response.ok && response.status >= 200 && response.status < 300) {
        const confirmed: SignedWebhookDelivery = {
          ...attemptState,
          status: "delivered_confirmed",
          delivered: true,
          http_status: response.status,
          response_excerpt: bodyText.slice(0, 200)
        };
        this.webhookDeliveries.set(delivery.delivery_id, confirmed);
        return confirmed;
      }

      const failed: SignedWebhookDelivery = {
        ...attemptState,
        status: "failed",
        delivered: false,
        http_status: response.status,
        error_reason: `Remote endpoint returned HTTP ${response.status}: ${bodyText.slice(0, 200)}`
      };
      this.webhookDeliveries.set(delivery.delivery_id, failed);
      return failed;
    } catch (error) {
      const failed: SignedWebhookDelivery = {
        ...attemptState,
        status: "failed",
        delivered: false,
        error_reason: error instanceof Error ? error.message : String(error)
      };
      this.webhookDeliveries.set(delivery.delivery_id, failed);
      return failed;
    }
  }

  public verifyWebhookSignature(
    payloadJson: string,
    timestamp: number,
    signatureHeader: string,
    webhookSecret: string,
    toleranceMs = 300_000,
    nowMs = Date.now()
  ): boolean {
    if (Math.abs(nowMs - timestamp) > toleranceMs) {
      return false;
    }
    const expected = `v1=${createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payloadJson}`)
      .digest("hex")}`;
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
