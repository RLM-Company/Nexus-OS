import type { CapabilityId, PolicyIntent, PolicyVerdict } from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, PolicyStore, ProjectStore, runMigrations } from "../src/index.js";

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
    expect(store.reserveAllowed(intent, allowedVerdict, "2026-08-24T12:02:00.000Z").status).toBe(
      "RESERVED"
    );
    expect(
      store.listActivePermissions(projectId, "manager", "2026-08-24T12:03:00.000Z")
    ).toHaveLength(0);
    expect(store.getConfirmation(confirmation.confirmation_id)?.status).toBe("CONSUMED");
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
