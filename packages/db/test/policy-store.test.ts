import type { CapabilityId, PolicyIntent, PolicyVerdict } from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  PolicyStore,
  PolicyStoreConflictError,
  ProjectStore,
  runMigrations
} from "../src/index.js";

const NOW = "2026-08-24T12:00:00.000Z";

const confirmationVerdict = (intent: PolicyIntent, capabilityId: CapabilityId): PolicyVerdict => ({
  operation_id: intent.operation_id,
  verdict: "NEEDS_CONFIRMATION",
  evaluated_capabilities: [
    { capability_id: capabilityId, mode: "CONFIRM", scope: [], conditions: [] }
  ],
  permission_ids: [],
  reasons: ["Owner confirmation is required."],
  evaluated_at: NOW,
  policy_version: "1.1.0"
});

describe("PolicyStore", () => {
  let database: ReturnType<typeof openDatabase>;
  let store: PolicyStore;
  let projectId: string;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectId = new ProjectStore(database.sqlite).createProject("Policy test", "policy-project")
      .project.id;
    store = new PolicyStore(database.sqlite);
  });

  afterEach(() => database.close());

  it("creates an A0 profile and updates it with compare-and-swap versioning", () => {
    const initial = store.ensureProfile(projectId, NOW);
    expect(initial).toMatchObject({ project_id: projectId, base_level: "A0", version: 1 });
    expect(initial?.grants).toHaveLength(19);

    const updated = store.updateProfile({
      projectId,
      baseLevel: "A3",
      overrides: [],
      expectedVersion: 1,
      issuedAt: NOW
    });
    expect(updated).toMatchObject({ base_level: "A3", version: 2 });
    expect(
      store.updateProfile({
        projectId,
        baseLevel: "A4",
        overrides: [],
        expectedVersion: 1,
        issuedAt: NOW
      })
    ).toBeNull();
  });

  it("turns approval into one atomic, one-use permission", () => {
    store.ensureProfile(projectId, NOW);
    const intent: PolicyIntent = {
      operation_id: "operation-confirm",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-1"],
      purpose: "Send an approved campaign message",
      idempotency_key: "confirmation-once"
    };
    const verdict = confirmationVerdict(intent, "external.communicate");
    const confirmation = store.createConfirmation(intent, verdict, NOW);
    const decision = store.decideConfirmation({
      confirmationId: confirmation.confirmation_id,
      challengeNonce: confirmation.challenge_nonce,
      decision: "approve",
      decidedBy: "local-owner",
      approvalMethod: "session",
      decidedAt: "2026-08-24T12:01:00.000Z"
    });
    expect(decision.status).toBe("APPROVED");
    const permissions = store.listActivePermissions(
      projectId,
      "manager",
      "2026-08-24T12:02:00.000Z"
    );
    expect(permissions).toHaveLength(1);

    const allowedVerdict: PolicyVerdict = {
      ...verdict,
      verdict: "ALLOW",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "AUTONOMOUS",
          scope: ["campaign-1"],
          conditions: ["owner_confirmed_operation"]
        }
      ],
      permission_ids: [permissions[0]!.permission_id]
    };
    expect(
      store.reserveAllowed(
        intent,
        allowedVerdict,
        {
          profileVersion: store.getProfile(projectId)!.version,
          appliedOverrideIds: []
        },
        "2026-08-24T12:02:00.000Z"
      ).status
    ).toBe("RESERVED");
    expect(
      store.listActivePermissions(projectId, "manager", "2026-08-24T12:03:00.000Z")
    ).toHaveLength(0);
    expect(store.getConfirmation(confirmation.confirmation_id)?.status).toBe("CONSUMED");
  });

  it("rejects policy decisions that are not exactly bound to their intent", () => {
    const profile = store.ensureProfile(projectId, NOW)!;
    const intent: PolicyIntent = {
      operation_id: "operation-boundary",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-boundary"],
      purpose: "Send one bounded campaign message",
      idempotency_key: "operation-boundary"
    };
    const confirmation = confirmationVerdict(intent, "external.communicate");

    expect(() =>
      store.createConfirmation(intent, { ...confirmation, operation_id: "another-operation" }, NOW)
    ).toThrow(PolicyStoreConflictError);
    expect(() =>
      store.createConfirmation(
        intent,
        {
          ...confirmation,
          evaluated_capabilities: [
            { capability_id: "workspace.write", mode: "CONFIRM", scope: [], conditions: [] }
          ]
        },
        NOW
      )
    ).toThrow(PolicyStoreConflictError);
    expect(() =>
      store.createConfirmation(
        intent,
        {
          ...confirmation,
          evaluated_capabilities: [
            {
              capability_id: "external.communicate",
              mode: "AUTONOMOUS",
              scope: [],
              conditions: []
            }
          ]
        },
        NOW
      )
    ).toThrow(PolicyStoreConflictError);
    expect(() =>
      store.createConfirmation(intent, confirmation, "2026-08-24T11:59:59.000Z")
    ).toThrow(PolicyStoreConflictError);
    expect(() => store.createConfirmation(intent, confirmation, NOW, 0)).toThrow(RangeError);

    const denied: PolicyVerdict = {
      ...confirmation,
      verdict: "DENY",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "DENY",
          scope: [],
          conditions: []
        }
      ]
    };
    expect(() => store.recordBlocked(intent, denied, "PAUSED", NOW)).toThrow(
      PolicyStoreConflictError
    );

    const allowed: PolicyVerdict = {
      ...confirmation,
      verdict: "ALLOW",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "AUTONOMOUS",
          scope: [],
          conditions: []
        }
      ]
    };
    expect(
      store.reserveAllowed(
        intent,
        {
          ...allowed,
          evaluated_capabilities: [
            {
              capability_id: "workspace.write",
              mode: "AUTONOMOUS",
              scope: [],
              conditions: []
            }
          ]
        },
        { profileVersion: profile.version, appliedOverrideIds: [] },
        NOW
      ).status
    ).toBe("AUTHORITY_CHANGED");
    expect(
      store.reserveAllowed(
        intent,
        {
          ...allowed,
          evaluated_capabilities: [
            {
              capability_id: "external.communicate",
              mode: "DENY",
              scope: [],
              conditions: []
            }
          ]
        },
        { profileVersion: profile.version, appliedOverrideIds: [] },
        NOW
      ).status
    ).toBe("AUTHORITY_CHANGED");

    expect(store.getOperation(projectId, intent.idempotency_key)).toBeNull();
    expect(store.listConfirmations(projectId)).toEqual([]);
    expect(store.listDecisionTrace(projectId)).toEqual([]);
  });

  it("returns bounded content-minimized decisions without duplicate replay events", () => {
    const intent: PolicyIntent = {
      operation_id: "operation-trace",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-trace-1"],
      purpose: "Sensitive campaign copy must stay out of Decision Trace",
      idempotency_key: "private-idempotency-key"
    };
    const verdict: PolicyVerdict = {
      ...confirmationVerdict(intent, "external.communicate"),
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "CONFIRM",
          scope: ["private-audience-segment"],
          conditions: []
        }
      ],
      permission_ids: ["internal-permission-id"]
    };
    const first = store.createConfirmation(intent, verdict, NOW);
    const replay = store.createConfirmation(intent, verdict, NOW);

    expect(replay.confirmation_id).toBe(first.confirmation_id);
    expect(store.listDecisionTrace(projectId)).toHaveLength(1);
    expect(store.listDecisionTrace(projectId)).toEqual([
      expect.objectContaining({
        operation_id: intent.operation_id,
        project_id: projectId,
        actor_id: "manager",
        verdict: "NEEDS_CONFIRMATION",
        capability_ids: ["external.communicate"],
        object_ids: ["campaign-trace-1"],
        reasons: ["Owner confirmation is required."],
        policy_version: "1.1.0"
      })
    ]);
    const serialized = JSON.stringify(store.listDecisionTrace(projectId));
    expect(serialized).not.toContain(intent.purpose);
    expect(serialized).not.toContain(intent.idempotency_key);
    expect(serialized).not.toContain("private-audience-segment");
    expect(serialized).not.toContain("internal-permission-id");

    expect(
      store.decideConfirmation({
        confirmationId: first.confirmation_id,
        challengeNonce: first.challenge_nonce,
        decision: "reject",
        decidedBy: "local-owner",
        approvalMethod: "session",
        reason: "Owner rejected the operation",
        decidedAt: "2026-08-24T12:01:00.000Z"
      }).status
    ).toBe("REJECTED");
    expect(store.listDecisionTrace(projectId, 1)).toEqual([
      expect.objectContaining({
        operation_id: intent.operation_id,
        verdict: "DENY",
        reasons: ["Owner confirmation is required.", "Confirmation was rejected by the owner."]
      })
    ]);
    expect(() => store.listDecisionTrace(projectId, 0)).toThrow(RangeError);
    expect(() => store.listDecisionTrace(projectId, 101)).toThrow(RangeError);
  });

  it("lists reserved operations as content-minimized recovery-required records", () => {
    const profile = store.ensureProfile(projectId, NOW)!;
    const intent: PolicyIntent = {
      operation_id: "operation-recovery",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-recovery-1"],
      purpose: "Private campaign content must stay out of recovery views",
      idempotency_key: "private-recovery-idempotency"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "ALLOW",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "AUTONOMOUS",
          scope: ["private-recipient-list"],
          conditions: []
        }
      ],
      permission_ids: [],
      reasons: ["Operation was allowed by the active profile."],
      evaluated_at: NOW,
      policy_version: "1.1.0"
    };

    const authority = {
      profileVersion: profile.version,
      appliedOverrideIds: []
    };
    expect(
      store.reserveAllowed(intent, verdict, authority, "2026-09-02T04:00:00.000Z").status
    ).toBe("RESERVED");
    expect(store.reserveAllowed(intent, verdict, authority).status).toBe("RECOVERY_REQUIRED");
    expect(store.listRecoveryRequired(projectId)).toEqual([
      {
        operation_id: intent.operation_id,
        project_id: projectId,
        actor_id: "manager",
        recovery_status: "RECOVERY_REQUIRED",
        capability_ids: ["external.communicate"],
        object_ids: ["campaign-recovery-1"],
        reasons: ["Operation was allowed by the active profile."],
        policy_version: "1.1.0",
        reserved_at: "2026-09-02T04:00:00.000Z"
      }
    ]);
    const serialized = JSON.stringify(store.listRecoveryRequired(projectId));
    expect(serialized).not.toContain(intent.purpose);
    expect(serialized).not.toContain(intent.idempotency_key);
    expect(serialized).not.toContain("private-recipient-list");
    expect(() => store.listRecoveryRequired(projectId, 0)).toThrow(RangeError);
    expect(() => store.listRecoveryRequired(projectId, 101)).toThrow(RangeError);

    store.completeOperation(intent.operation_id, { private: "result" });
    expect(store.listRecoveryRequired(projectId)).toEqual([]);
  });

  it("atomically consumes finite overrides once and rejects stale authority", () => {
    const initial = store.ensureProfile(projectId, NOW)!;
    const finite = store.updateProfile({
      projectId,
      baseLevel: "A0",
      overrides: [
        {
          override_id: "finite-workspace-write",
          capability_id: "workspace.write",
          mode: "AUTONOMOUS",
          object_ids: [projectId],
          purpose: "Allow exactly two project writes",
          valid_until: null,
          remaining_uses: 2
        }
      ],
      expectedVersion: initial.version,
      issuedAt: NOW
    })!;
    const intent: PolicyIntent = {
      operation_id: "finite-operation-1",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["workspace.write"],
      object_ids: [projectId],
      purpose: "Write one project artifact",
      idempotency_key: "finite-write-1"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "ALLOW",
      evaluated_capabilities: [
        { capability_id: "workspace.write", mode: "AUTONOMOUS", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["Finite override allowed the exact project object."],
      evaluated_at: NOW,
      policy_version: "1.1.0"
    };
    const authority = {
      profileVersion: finite.version,
      appliedOverrideIds: ["finite-workspace-write"]
    };

    expect(
      store.reserveAllowed(
        intent,
        { ...verdict, permission_ids: ["missing-permission"] },
        authority,
        NOW
      ).status
    ).toBe("PERMISSION_EXHAUSTED");
    expect(store.getProfile(projectId)).toMatchObject({
      version: 2,
      overrides: [{ override_id: "finite-workspace-write", remaining_uses: 2 }]
    });
    expect(store.getOperation(projectId, intent.idempotency_key)).toBeNull();

    expect(store.reserveAllowed(intent, verdict, authority, NOW).status).toBe("RESERVED");
    expect(store.getProfile(projectId)).toMatchObject({
      version: 3,
      overrides: [{ override_id: "finite-workspace-write", remaining_uses: 1 }]
    });
    store.completeOperation(intent.operation_id, { ok: true }, "2026-08-24T12:00:01.000Z");
    expect(store.reserveAllowed(intent, verdict, authority, NOW).status).toBe("REPLAY");
    expect(store.getProfile(projectId)).toMatchObject({
      version: 3,
      overrides: [{ override_id: "finite-workspace-write", remaining_uses: 1 }]
    });

    const secondIntent: PolicyIntent = {
      ...intent,
      operation_id: "finite-operation-2",
      idempotency_key: "finite-write-2"
    };
    const secondVerdict: PolicyVerdict = { ...verdict, operation_id: secondIntent.operation_id };
    expect(store.reserveAllowed(secondIntent, secondVerdict, authority, NOW).status).toBe(
      "AUTHORITY_CHANGED"
    );
    const refreshedAuthority = {
      profileVersion: store.getProfile(projectId)!.version,
      appliedOverrideIds: ["finite-workspace-write"]
    };
    expect(store.reserveAllowed(secondIntent, secondVerdict, refreshedAuthority, NOW).status).toBe(
      "RESERVED"
    );
    expect(store.getProfile(projectId)).toMatchObject({ version: 4, overrides: [] });
  });

  it("revalidates override expiry and timestamp chronology at atomic reservation", () => {
    const initial = store.ensureProfile(projectId, NOW)!;
    const finite = store.updateProfile({
      projectId,
      baseLevel: "A0",
      overrides: [
        {
          override_id: "expiring-workspace-write",
          capability_id: "workspace.write",
          mode: "AUTONOMOUS",
          object_ids: [projectId],
          purpose: "Allow one bounded write before expiry",
          valid_until: "2026-08-24T12:00:01.000Z",
          remaining_uses: 1
        }
      ],
      expectedVersion: initial.version,
      issuedAt: NOW
    })!;
    const intent: PolicyIntent = {
      operation_id: "expiring-override-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["workspace.write"],
      object_ids: [projectId],
      purpose: "Allow one bounded write before expiry",
      idempotency_key: "expiring-override-operation"
    };
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "ALLOW",
      evaluated_capabilities: [
        { capability_id: "workspace.write", mode: "AUTONOMOUS", scope: [], conditions: [] }
      ],
      permission_ids: [],
      reasons: ["The point override was active during evaluation."],
      evaluated_at: NOW,
      policy_version: "1.1.0"
    };
    const authority = {
      profileVersion: finite.version,
      appliedOverrideIds: ["expiring-workspace-write"]
    };

    expect(
      store.reserveAllowed(intent, verdict, authority, "2026-08-24T12:00:02.000Z").status
    ).toBe("AUTHORITY_CHANGED");
    expect(store.getOperation(projectId, intent.idempotency_key)).toBeNull();
    expect(store.getProfile(projectId)).toMatchObject({
      version: finite.version,
      overrides: [{ override_id: "expiring-workspace-write", remaining_uses: 1 }]
    });

    const backwardsIntent: PolicyIntent = {
      ...intent,
      operation_id: "backwards-time-operation",
      idempotency_key: "backwards-time-operation"
    };
    expect(
      store.reserveAllowed(
        backwardsIntent,
        { ...verdict, operation_id: backwardsIntent.operation_id },
        authority,
        "2026-08-24T11:59:59.000Z"
      ).status
    ).toBe("AUTHORITY_CHANGED");
    expect(store.getOperation(projectId, backwardsIntent.idempotency_key)).toBeNull();
  });

  it("revalidates permission expiry at atomic reservation", () => {
    const profile = store.ensureProfile(projectId, NOW)!;
    const intent: PolicyIntent = {
      operation_id: "expiring-permission-operation",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-expiring-permission"],
      purpose: "Send one message while the permission is valid",
      idempotency_key: "expiring-permission-operation"
    };
    const confirmation = store.createConfirmation(
      intent,
      confirmationVerdict(intent, "external.communicate"),
      NOW,
      1_000
    );
    const approval = store.decideConfirmation({
      confirmationId: confirmation.confirmation_id,
      challengeNonce: confirmation.challenge_nonce,
      decision: "approve",
      decidedBy: "local-owner",
      approvalMethod: "session",
      decidedAt: "2026-08-24T12:00:00.500Z"
    });
    expect(approval.status).toBe("APPROVED");
    if (approval.status !== "APPROVED") throw new Error("Expected permission approval");
    const verdict: PolicyVerdict = {
      operation_id: intent.operation_id,
      verdict: "ALLOW",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "AUTONOMOUS",
          scope: [...intent.object_ids],
          conditions: ["owner_confirmed_operation"]
        }
      ],
      permission_ids: [approval.permission.permission_id],
      reasons: ["The owner permission was active during evaluation."],
      evaluated_at: "2026-08-24T12:00:00.500Z",
      policy_version: "1.1.0"
    };

    const otherPurposeIntent: PolicyIntent = {
      ...intent,
      operation_id: "different-purpose-operation",
      purpose: "Reuse the approval for a different message",
      idempotency_key: "different-purpose-operation"
    };
    expect(
      store.reserveAllowed(
        otherPurposeIntent,
        { ...verdict, operation_id: otherPurposeIntent.operation_id },
        { profileVersion: profile.version, appliedOverrideIds: [] },
        "2026-08-24T12:00:00.750Z"
      ).status
    ).toBe("AUTHORITY_CHANGED");
    expect(store.getOperation(projectId, otherPurposeIntent.idempotency_key)).toBeNull();

    expect(
      store.reserveAllowed(
        intent,
        verdict,
        { profileVersion: profile.version, appliedOverrideIds: [] },
        "2026-08-24T12:00:02.000Z"
      ).status
    ).toBe("PERMISSION_EXHAUSTED");
    expect(store.getOperation(projectId, intent.idempotency_key)).toMatchObject({
      status: "READY"
    });
    expect(
      store.listActivePermissions(projectId, "manager", "2026-08-24T12:00:02.000Z")
    ).toHaveLength(0);
  });

  it("refuses a session-only approval for a critical capability", () => {
    const intent: PolicyIntent = {
      operation_id: "operation-finance",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["finance.spend"],
      object_ids: ["invoice-1"],
      purpose: "Pay invoice",
      idempotency_key: "finance-confirmation"
    };
    const confirmation = store.createConfirmation(
      intent,
      confirmationVerdict(intent, "finance.spend"),
      NOW
    );
    expect(confirmation.requires_step_up).toBe(true);
    expect(
      store.decideConfirmation({
        confirmationId: confirmation.confirmation_id,
        challengeNonce: confirmation.challenge_nonce,
        decision: "approve",
        decidedBy: "local-owner",
        approvalMethod: "session",
        decidedAt: "2026-08-24T12:01:00.000Z"
      }).status
    ).toBe("STEP_UP_REQUIRED");
  });

  it("expires stale confirmations and records a terminal deny verdict", () => {
    const intent: PolicyIntent = {
      operation_id: "operation-expired",
      project_id: projectId,
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["recipient-2"],
      purpose: "Send a time-sensitive message",
      idempotency_key: "expired-confirmation"
    };
    store.createConfirmation(
      intent,
      confirmationVerdict(intent, "external.communicate"),
      NOW,
      1_000
    );
    const expired = store.listConfirmations(projectId, "EXPIRED", "2026-08-24T12:00:02.000Z");
    expect(expired).toHaveLength(1);
    expect(store.getOperation(projectId, intent.idempotency_key)).toMatchObject({
      status: "DENIED",
      verdict: { verdict: "DENY" }
    });
  });
});
