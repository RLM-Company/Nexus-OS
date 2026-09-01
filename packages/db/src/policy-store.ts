import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  CapabilityProfileSchema,
  ConfirmationRequestSchema,
  PermissionContractSchema,
  PolicyDecisionTraceEventSchema,
  PolicyIntentSchema,
  PolicyVerdictSchema,
  createCapabilityProfile,
  requiresStepUp,
  type AutonomyLevel,
  type CapabilityOverride,
  type CapabilityProfile,
  type ConfirmationRequest,
  type ConfirmationStatus,
  type PermissionContract,
  type PolicyDecisionTraceEvent,
  type PolicyIntent,
  type PolicyVerdict,
  type ToolOperationStatus
} from "@cosmora/contracts";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";

type SqlRow = Record<string, unknown>;

export interface StoredPolicyOperation {
  operation_id: string;
  project_id: string;
  actor_id: string;
  idempotency_key: string;
  status: ToolOperationStatus;
  intent: PolicyIntent;
  verdict: PolicyVerdict;
  confirmation_id: string | null;
  result: unknown;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export type ConfirmationDecisionResult =
  | { status: "APPROVED"; confirmation: ConfirmationRequest; permission: PermissionContract }
  | { status: "REJECTED"; confirmation: ConfirmationRequest }
  | {
      status: "NOT_FOUND" | "NONCE_MISMATCH" | "ALREADY_DECIDED" | "EXPIRED" | "STEP_UP_REQUIRED";
    };

export type ReservationResult =
  | { status: "RESERVED"; operation: StoredPolicyOperation }
  | { status: "REPLAY"; operation: StoredPolicyOperation }
  | { status: "BLOCKED" | "RECOVERY_REQUIRED"; operation: StoredPolicyOperation }
  | { status: "PERMISSION_EXHAUSTED" };

export class PolicyStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyStoreConflictError";
  }
}

const nowIso = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

const parseChecked = <T>(schema: TSchema, source: unknown): T => {
  if (typeof source !== "string") throw new Error("Stored policy JSON is not text");
  const value: unknown = JSON.parse(source);
  if (!Value.Check(schema, value)) throw new Error("Stored policy JSON failed validation");
  return value as T;
};

const asOperation = (row: SqlRow): StoredPolicyOperation => ({
  operation_id: String(row.operation_id),
  project_id: String(row.project_id),
  actor_id: String(row.actor_id),
  idempotency_key: String(row.idempotency_key),
  status: row.status as ToolOperationStatus,
  intent: parseChecked<PolicyIntent>(PolicyIntentSchema, row.intent_json),
  verdict: parseChecked<PolicyVerdict>(PolicyVerdictSchema, row.verdict_json),
  confirmation_id: typeof row.confirmation_id === "string" ? row.confirmation_id : null,
  result: typeof row.result_json === "string" ? JSON.parse(row.result_json) : null,
  error_code: typeof row.error_code === "string" ? row.error_code : null,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const decisionTraceFromRow = (row: SqlRow): PolicyDecisionTraceEvent => {
  const intent = parseChecked<PolicyIntent>(PolicyIntentSchema, row.intent_json);
  const verdict = parseChecked<PolicyVerdict>(PolicyVerdictSchema, row.verdict_json);
  const projectId = String(row.project_id);
  const operationId = String(row.operation_id);
  if (
    intent.project_id !== projectId ||
    intent.operation_id !== operationId ||
    verdict.operation_id !== operationId ||
    verdict.verdict !== String(row.verdict)
  ) {
    throw new Error("Stored policy decision bindings failed validation");
  }
  const event: PolicyDecisionTraceEvent = {
    decision_id: String(row.decision_id),
    operation_id: operationId,
    project_id: projectId,
    actor_id: intent.actor_id,
    verdict: verdict.verdict,
    capability_ids: [...intent.capability_ids],
    object_ids: [...intent.object_ids],
    reasons: [...verdict.reasons],
    policy_version: verdict.policy_version,
    evaluated_at: verdict.evaluated_at,
    created_at: String(row.created_at)
  };
  if (!Value.Check(PolicyDecisionTraceEventSchema, event)) {
    throw new Error("Stored policy decision trace failed validation");
  }
  return event;
};

const confirmationFromRow = (row: SqlRow): ConfirmationRequest =>
  parseChecked<ConfirmationRequest>(
    ConfirmationRequestSchema,
    json({
      confirmation_id: row.confirmation_id,
      project_id: row.project_id,
      operation_id: row.operation_id,
      actor_id: row.actor_id,
      intent: parseChecked<PolicyIntent>(PolicyIntentSchema, row.intent_json),
      verdict: parseChecked<PolicyVerdict>(PolicyVerdictSchema, row.verdict_json),
      status: row.status,
      challenge_nonce: row.challenge_nonce,
      requires_step_up: Boolean(row.requires_step_up),
      requested_at: row.requested_at,
      expires_at: row.expires_at,
      decided_at: row.decided_at ?? null,
      decided_by: row.decided_by ?? null,
      decision_reason: row.decision_reason ?? null
    })
  );

const deniedConfirmationVerdict = (
  confirmation: ConfirmationRequest,
  evaluatedAt: string,
  reason: string
): PolicyVerdict => ({
  ...confirmation.verdict,
  verdict: "DENY",
  permission_ids: [],
  reasons: [...confirmation.verdict.reasons, reason],
  evaluated_at: evaluatedAt
});

export class PolicyStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  #get(statement: StatementSync, ...values: Array<string | number>): SqlRow | undefined {
    return statement.get(...values);
  }

  #transaction<T>(operation: () => T): T {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.#sqlite.exec("COMMIT;");
      return result;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  getProfile(projectId: string): CapabilityProfile | null {
    const row = this.#get(
      this.#sqlite.prepare("SELECT profile_json FROM autonomy_profiles WHERE project_id = ?"),
      projectId
    );
    return row ? parseChecked<CapabilityProfile>(CapabilityProfileSchema, row.profile_json) : null;
  }

  ensureProfile(projectId: string, issuedAt = nowIso()): CapabilityProfile | null {
    const existing = this.getProfile(projectId);
    if (existing) return existing;
    const project = this.#get(
      this.#sqlite.prepare("SELECT id FROM projects WHERE id = ?"),
      projectId
    );
    if (!project) return null;
    const profile = createCapabilityProfile({
      profileId: randomUUID(),
      projectId,
      baseLevel: "A0",
      version: 1,
      issuedAt
    });
    this.#sqlite
      .prepare(
        `INSERT OR IGNORE INTO autonomy_profiles
          (project_id, profile_id, base_level, version, profile_json, issued_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.project_id,
        profile.profile_id,
        profile.base_level,
        profile.version,
        json(profile),
        profile.issued_at,
        issuedAt
      );
    return this.getProfile(projectId);
  }

  updateProfile(input: {
    projectId: string;
    baseLevel: AutonomyLevel;
    overrides: CapabilityOverride[];
    expectedVersion: number;
    issuedAt?: string;
  }): CapabilityProfile | null {
    const current = this.getProfile(input.projectId);
    if (!current || current.version !== input.expectedVersion) return null;
    const issuedAt = input.issuedAt ?? nowIso();
    const next = createCapabilityProfile({
      profileId: current.profile_id,
      projectId: current.project_id,
      baseLevel: input.baseLevel,
      overrides: input.overrides,
      version: current.version + 1,
      issuedAt
    });
    const result = this.#sqlite
      .prepare(
        `UPDATE autonomy_profiles
         SET base_level = ?, version = ?, profile_json = ?, issued_at = ?, updated_at = ?
         WHERE project_id = ? AND version = ?`
      )
      .run(
        next.base_level,
        next.version,
        json(next),
        next.issued_at,
        issuedAt,
        input.projectId,
        input.expectedVersion
      );
    return result.changes === 1 ? next : null;
  }

  listActivePermissions(
    projectId: string,
    subjectId: string,
    evaluatedAt: string
  ): PermissionContract[] {
    this.#sqlite
      .prepare(
        `UPDATE permission_contracts
         SET state = 'EXPIRED', updated_at = ?
         WHERE project_id = ? AND state = 'ACTIVE' AND valid_until IS NOT NULL AND valid_until < ?`
      )
      .run(evaluatedAt, projectId, evaluatedAt);
    return (
      this.#sqlite
        .prepare(
          `SELECT contract_json FROM permission_contracts
           WHERE project_id = ? AND subject_id = ? AND state = 'ACTIVE'
             AND valid_from <= ? AND (valid_until IS NULL OR valid_until >= ?)
             AND (operations_limit IS NULL OR operations_used < operations_limit)`
        )
        .all(projectId, subjectId, evaluatedAt, evaluatedAt) as unknown as SqlRow[]
    ).map((row) => parseChecked<PermissionContract>(PermissionContractSchema, row.contract_json));
  }

  getOperation(projectId: string, idempotencyKey: string): StoredPolicyOperation | null {
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT operation_id, project_id, actor_id, idempotency_key, status, intent_json,
          verdict_json, confirmation_id, result_json, error_code, created_at, updated_at
         FROM policy_operations WHERE project_id = ? AND idempotency_key = ?`
      ),
      projectId,
      idempotencyKey
    );
    return row ? asOperation(row) : null;
  }

  listDecisionTrace(projectId: string, limit = 50): PolicyDecisionTraceEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Policy Decision Trace limit must be an integer between 1 and 100");
    }
    const rows = this.#sqlite
      .prepare(
        `SELECT decision_id, operation_id, project_id, verdict, intent_json, verdict_json,
          created_at
         FROM policy_decisions
         WHERE project_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(projectId, limit) as unknown as SqlRow[];
    return rows.map(decisionTraceFromRow);
  }

  #assertSameIntent(existing: StoredPolicyOperation, intent: PolicyIntent): void {
    if (json(existing.intent) !== json(intent)) {
      throw new PolicyStoreConflictError("Idempotency key is already bound to another intent");
    }
  }

  #recordDecision(intent: PolicyIntent, verdict: PolicyVerdict, timestamp: string): void {
    this.#sqlite
      .prepare(
        `INSERT INTO policy_decisions
          (decision_id, operation_id, project_id, verdict, intent_json, verdict_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        intent.operation_id,
        intent.project_id,
        verdict.verdict,
        json(intent),
        json(verdict),
        timestamp
      );
  }

  createConfirmation(
    intent: PolicyIntent,
    verdict: PolicyVerdict,
    requestedAt: string,
    ttlMs = 15 * 60 * 1_000
  ): ConfirmationRequest {
    return this.#transaction(() => {
      const existing = this.getOperation(intent.project_id, intent.idempotency_key);
      if (existing) {
        this.#assertSameIntent(existing, intent);
        if (!existing.confirmation_id) {
          throw new PolicyStoreConflictError("Existing operation has no confirmation request");
        }
        const confirmation = this.getConfirmation(existing.confirmation_id);
        if (!confirmation) throw new Error("Confirmation record is missing");
        return confirmation;
      }
      const confirmationId = randomUUID();
      const expiresAt = new Date(Date.parse(requestedAt) + ttlMs).toISOString();
      const challengeNonce = randomBytes(24).toString("base64url");
      this.#sqlite
        .prepare(
          `INSERT INTO confirmation_requests
            (confirmation_id, project_id, operation_id, actor_id, status, intent_json, verdict_json,
             challenge_nonce, requires_step_up, requested_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          confirmationId,
          intent.project_id,
          intent.operation_id,
          intent.actor_id,
          json(intent),
          json(verdict),
          challengeNonce,
          requiresStepUp(intent.capability_ids) ? 1 : 0,
          requestedAt,
          expiresAt
        );
      this.#sqlite
        .prepare(
          `INSERT INTO policy_operations
            (operation_id, project_id, actor_id, idempotency_key, status, intent_json, verdict_json,
             confirmation_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'WAITING_CONFIRMATION', ?, ?, ?, ?, ?)`
        )
        .run(
          intent.operation_id,
          intent.project_id,
          intent.actor_id,
          intent.idempotency_key,
          json(intent),
          json(verdict),
          confirmationId,
          requestedAt,
          requestedAt
        );
      this.#recordDecision(intent, verdict, requestedAt);
      const confirmation = this.getConfirmation(confirmationId);
      if (!confirmation) throw new Error("Failed to create confirmation");
      return confirmation;
    });
  }

  getConfirmation(confirmationId: string): ConfirmationRequest | null {
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT confirmation_id, project_id, operation_id, actor_id, status, intent_json,
          verdict_json, challenge_nonce, requires_step_up, requested_at, expires_at,
          decided_at, decided_by, decision_reason
         FROM confirmation_requests WHERE confirmation_id = ?`
      ),
      confirmationId
    );
    return row ? confirmationFromRow(row) : null;
  }

  listConfirmations(
    projectId: string,
    status?: ConfirmationStatus,
    evaluatedAt = nowIso()
  ): ConfirmationRequest[] {
    this.#transaction(() => {
      const expired = (
        this.#sqlite
          .prepare(
            `SELECT confirmation_id, project_id, operation_id, actor_id, status, intent_json,
              verdict_json, challenge_nonce, requires_step_up, requested_at, expires_at,
              decided_at, decided_by, decision_reason
             FROM confirmation_requests
             WHERE project_id = ? AND status = 'PENDING' AND expires_at < ?`
          )
          .all(projectId, evaluatedAt) as unknown as SqlRow[]
      ).map(confirmationFromRow);
      for (const confirmation of expired) {
        const denied = deniedConfirmationVerdict(
          confirmation,
          evaluatedAt,
          "Confirmation expired before approval."
        );
        this.#sqlite
          .prepare(
            `UPDATE policy_operations SET status = 'DENIED', verdict_json = ?, updated_at = ?
             WHERE operation_id = ?`
          )
          .run(json(denied), evaluatedAt, confirmation.operation_id);
        this.#sqlite
          .prepare(
            `UPDATE confirmation_requests SET status = 'EXPIRED', decided_at = ?
             WHERE confirmation_id = ?`
          )
          .run(evaluatedAt, confirmation.confirmation_id);
        this.#recordDecision(confirmation.intent, denied, evaluatedAt);
      }
    });
    const statement = status
      ? this.#sqlite.prepare(
          `SELECT confirmation_id, project_id, operation_id, actor_id, status, intent_json,
            verdict_json, challenge_nonce, requires_step_up, requested_at, expires_at,
            decided_at, decided_by, decision_reason
           FROM confirmation_requests WHERE project_id = ? AND status = ? ORDER BY requested_at DESC`
        )
      : this.#sqlite.prepare(
          `SELECT confirmation_id, project_id, operation_id, actor_id, status, intent_json,
            verdict_json, challenge_nonce, requires_step_up, requested_at, expires_at,
            decided_at, decided_by, decision_reason
           FROM confirmation_requests WHERE project_id = ? ORDER BY requested_at DESC`
        );
    const rows = status
      ? (statement.all(projectId, status) as unknown as SqlRow[])
      : (statement.all(projectId) as unknown as SqlRow[]);
    return rows.map(confirmationFromRow);
  }

  decideConfirmation(input: {
    confirmationId: string;
    challengeNonce: string;
    decision: "approve" | "reject";
    decidedBy: string;
    approvalMethod: "session" | "step_up";
    reason?: string;
    decidedAt?: string;
  }): ConfirmationDecisionResult {
    return this.#transaction(() => {
      const confirmation = this.getConfirmation(input.confirmationId);
      if (!confirmation) return { status: "NOT_FOUND" };
      if (confirmation.challenge_nonce !== input.challengeNonce)
        return { status: "NONCE_MISMATCH" };
      if (confirmation.status !== "PENDING") return { status: "ALREADY_DECIDED" };
      const decidedAt = input.decidedAt ?? nowIso();
      if (Date.parse(confirmation.expires_at) < Date.parse(decidedAt)) {
        const denied = deniedConfirmationVerdict(
          confirmation,
          decidedAt,
          "Confirmation expired before approval."
        );
        this.#sqlite
          .prepare(
            "UPDATE confirmation_requests SET status = 'EXPIRED', decided_at = ? WHERE confirmation_id = ?"
          )
          .run(decidedAt, input.confirmationId);
        this.#sqlite
          .prepare(
            `UPDATE policy_operations SET status = 'DENIED', verdict_json = ?, updated_at = ?
             WHERE operation_id = ?`
          )
          .run(json(denied), decidedAt, confirmation.operation_id);
        this.#recordDecision(confirmation.intent, denied, decidedAt);
        return { status: "EXPIRED" };
      }
      if (
        input.decision === "approve" &&
        confirmation.requires_step_up &&
        input.approvalMethod !== "step_up"
      ) {
        return { status: "STEP_UP_REQUIRED" };
      }
      if (input.decision === "reject") {
        const denied = deniedConfirmationVerdict(
          confirmation,
          decidedAt,
          "Confirmation was rejected by the owner."
        );
        this.#sqlite
          .prepare(
            `UPDATE confirmation_requests SET status = 'REJECTED', decided_at = ?, decided_by = ?,
              decision_reason = ? WHERE confirmation_id = ?`
          )
          .run(
            decidedAt,
            input.decidedBy,
            input.reason ?? "Rejected by owner",
            input.confirmationId
          );
        this.#sqlite
          .prepare(
            `UPDATE policy_operations SET status = 'DENIED', verdict_json = ?, updated_at = ?
             WHERE operation_id = ?`
          )
          .run(json(denied), decidedAt, confirmation.operation_id);
        this.#recordDecision(confirmation.intent, denied, decidedAt);
        const rejected = this.getConfirmation(input.confirmationId);
        if (!rejected) throw new Error("Rejected confirmation disappeared");
        return { status: "REJECTED", confirmation: rejected };
      }

      const permission: PermissionContract = {
        permission_id: randomUUID(),
        version: 1,
        project_id: confirmation.project_id,
        subject_id: confirmation.actor_id,
        organizational_role: "account_owner",
        state: "ACTIVE",
        capabilities: confirmation.verdict.evaluated_capabilities
          .filter((grant) => grant.mode === "CONFIRM")
          .map((grant) => ({
            capability_id: grant.capability_id,
            mode: "AUTONOMOUS",
            scope: confirmation.intent.object_ids,
            conditions: ["owner_confirmed_operation"]
          })),
        purpose: confirmation.intent.purpose,
        object_ids: confirmation.intent.object_ids,
        valid_from: decidedAt,
        valid_until: confirmation.expires_at,
        limits: { money_minor: null, tokens: null, operations: 1, delegation_depth: 0 },
        parent_permission_id: null,
        approval: {
          approver_id: input.decidedBy,
          method: input.approvalMethod,
          terms_version: "policy-1.1.0",
          nonce: input.challengeNonce,
          approved_at: decidedAt
        }
      };
      if (!Value.Check(PermissionContractSchema, permission)) {
        throw new Error("Generated permission contract failed validation");
      }
      this.#sqlite
        .prepare(
          `INSERT INTO permission_contracts
            (permission_id, project_id, subject_id, confirmation_id, state, valid_from, valid_until,
             operations_limit, operations_used, contract_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 1, 0, ?, ?, ?)`
        )
        .run(
          permission.permission_id,
          permission.project_id,
          permission.subject_id,
          confirmation.confirmation_id,
          permission.valid_from,
          permission.valid_until,
          json(permission),
          decidedAt,
          decidedAt
        );
      this.#sqlite
        .prepare(
          `UPDATE confirmation_requests SET status = 'APPROVED', decided_at = ?, decided_by = ?,
            decision_reason = ? WHERE confirmation_id = ?`
        )
        .run(decidedAt, input.decidedBy, input.reason ?? "Approved by owner", input.confirmationId);
      this.#sqlite
        .prepare(
          "UPDATE policy_operations SET status = 'READY', updated_at = ? WHERE operation_id = ?"
        )
        .run(decidedAt, confirmation.operation_id);
      const approved = this.getConfirmation(input.confirmationId);
      if (!approved) throw new Error("Approved confirmation disappeared");
      return { status: "APPROVED", confirmation: approved, permission };
    });
  }

  recordBlocked(
    intent: PolicyIntent,
    verdict: PolicyVerdict,
    status: "DENIED" | "PAUSED",
    timestamp = nowIso()
  ): StoredPolicyOperation {
    return this.#transaction(() => {
      const existing = this.getOperation(intent.project_id, intent.idempotency_key);
      if (existing) {
        this.#assertSameIntent(existing, intent);
        return existing;
      }
      this.#sqlite
        .prepare(
          `INSERT INTO policy_operations
            (operation_id, project_id, actor_id, idempotency_key, status, intent_json, verdict_json,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          intent.operation_id,
          intent.project_id,
          intent.actor_id,
          intent.idempotency_key,
          status,
          json(intent),
          json(verdict),
          timestamp,
          timestamp
        );
      this.#recordDecision(intent, verdict, timestamp);
      const operation = this.getOperation(intent.project_id, intent.idempotency_key);
      if (!operation) throw new Error("Failed to record blocked operation");
      return operation;
    });
  }

  reserveAllowed(
    intent: PolicyIntent,
    verdict: PolicyVerdict,
    timestamp = nowIso()
  ): ReservationResult {
    return this.#transaction(() => {
      const existing = this.getOperation(intent.project_id, intent.idempotency_key);
      if (existing) {
        this.#assertSameIntent(existing, intent);
        if (existing.status === "SUCCEEDED") return { status: "REPLAY", operation: existing };
        if (existing.status === "RESERVED") {
          return { status: "RECOVERY_REQUIRED", operation: existing };
        }
        if (existing.status !== "READY") return { status: "BLOCKED", operation: existing };
      }

      for (const permissionId of verdict.permission_ids) {
        const available = this.#get(
          this.#sqlite.prepare(
            `SELECT permission_id FROM permission_contracts
             WHERE permission_id = ? AND state = 'ACTIVE'
               AND (operations_limit IS NULL OR operations_used < operations_limit)`
          ),
          permissionId
        );
        if (!available) return { status: "PERMISSION_EXHAUSTED" };
      }

      for (const permissionId of verdict.permission_ids) {
        const result = this.#sqlite
          .prepare(
            `UPDATE permission_contracts
             SET operations_used = operations_used + 1,
                 state = CASE
                   WHEN operations_limit IS NOT NULL AND operations_used + 1 >= operations_limit
                     THEN 'CONSUMED'
                   ELSE state
                 END,
                 updated_at = ?
             WHERE permission_id = ? AND state = 'ACTIVE'
               AND (operations_limit IS NULL OR operations_used < operations_limit)`
          )
          .run(timestamp, permissionId);
        if (result.changes !== 1)
          throw new Error("Permission changed during an atomic reservation");
        this.#sqlite
          .prepare(
            `UPDATE confirmation_requests SET status = 'CONSUMED'
             WHERE status = 'APPROVED' AND confirmation_id = (
               SELECT confirmation_id FROM permission_contracts WHERE permission_id = ?
             )`
          )
          .run(permissionId);
      }

      if (existing) {
        this.#sqlite
          .prepare(
            "UPDATE policy_operations SET status = 'RESERVED', verdict_json = ?, updated_at = ? WHERE operation_id = ?"
          )
          .run(json(verdict), timestamp, existing.operation_id);
      } else {
        this.#sqlite
          .prepare(
            `INSERT INTO policy_operations
              (operation_id, project_id, actor_id, idempotency_key, status, intent_json, verdict_json,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)`
          )
          .run(
            intent.operation_id,
            intent.project_id,
            intent.actor_id,
            intent.idempotency_key,
            json(intent),
            json(verdict),
            timestamp,
            timestamp
          );
      }
      this.#recordDecision(intent, verdict, timestamp);
      const operation = this.getOperation(intent.project_id, intent.idempotency_key);
      if (!operation) throw new Error("Failed to reserve operation");
      return { status: "RESERVED", operation };
    });
  }

  completeOperation(operationId: string, result: unknown, timestamp = nowIso()): void {
    this.#sqlite
      .prepare(
        `UPDATE policy_operations SET status = 'SUCCEEDED', result_json = ?, updated_at = ?
         WHERE operation_id = ? AND status = 'RESERVED'`
      )
      .run(json(result), timestamp, operationId);
  }

  failOperation(operationId: string, errorCode: string, timestamp = nowIso()): void {
    this.#sqlite
      .prepare(
        `UPDATE policy_operations SET status = 'FAILED', error_code = ?, updated_at = ?
         WHERE operation_id = ? AND status = 'RESERVED'`
      )
      .run(errorCode, timestamp, operationId);
  }
}
