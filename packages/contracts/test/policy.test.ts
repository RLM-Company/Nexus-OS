import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_LEVELS,
  AUTONOMY_MATRIX,
  CAPABILITY_IDS,
  CapabilityProfilePreviewResponseSchema,
  CapabilityProfileSchema,
  type CapabilityOverride,
  ConfirmationRequestSchema,
  PermissionContractSchema,
  PolicyDecisionTraceEventSchema,
  PolicyDecisionTraceListResponseSchema,
  PolicyEvaluationEnvelopeSchema,
  PolicyRecoveryRequiredListResponseSchema,
  PolicyRecoveryRequiredOperationSchema,
  PolicyVerdictSchema,
  createCapabilityProfile,
  getCapabilityMode,
  hasUniqueCapabilityOverrideIds,
  isAtLeastAsAutonomous,
  verdictForModes
} from "../src/policy.js";

describe("autonomy policy contracts", () => {
  it("defines every level for all 19 capabilities", () => {
    expect(CAPABILITY_IDS).toHaveLength(19);
    for (const capabilityId of CAPABILITY_IDS) {
      expect(Object.keys(AUTONOMY_MATRIX[capabilityId])).toEqual(AUTONOMY_LEVELS);
    }
  });

  it("is monotonic across every adjacent level", () => {
    for (const capabilityId of CAPABILITY_IDS) {
      for (let index = 1; index < AUTONOMY_LEVELS.length; index += 1) {
        const previous = AUTONOMY_LEVELS[index - 1];
        const current = AUTONOMY_LEVELS[index];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        if (previous === undefined || current === undefined) continue;
        expect(
          isAtLeastAsAutonomous(
            getCapabilityMode(current, capabilityId),
            getCapabilityMode(previous, capabilityId)
          )
        ).toBe(true);
      }
    }
  });

  it("never makes A5 less autonomous than A4", () => {
    for (const capabilityId of CAPABILITY_IDS) {
      expect(
        isAtLeastAsAutonomous(
          getCapabilityMode("A5", capabilityId),
          getCapabilityMode("A4", capabilityId)
        )
      ).toBe(true);
    }
  });

  it("makes every A6 capability FULL", () => {
    for (const capabilityId of CAPABILITY_IDS) {
      expect(getCapabilityMode("A6", capabilityId)).toBe("FULL");
    }
  });

  it("requires stable point override identities to be unique", () => {
    const override: CapabilityOverride = {
      override_id: "one-project-write",
      capability_id: "workspace.write",
      mode: "AUTONOMOUS",
      object_ids: ["project-1"],
      purpose: "Write one project artifact",
      valid_until: null,
      remaining_uses: 1
    };

    expect(hasUniqueCapabilityOverrideIds([override])).toBe(true);
    expect(hasUniqueCapabilityOverrideIds([override, { ...override, mode: "DENY" }])).toBe(false);
  });

  it("separates A1 read access from A2 persistent writes", () => {
    expect(getCapabilityMode("A1", "context.project.read")).toBe("SCOPED");
    expect(getCapabilityMode("A1", "workspace.write")).toBe("DENY");
    expect(getCapabilityMode("A2", "workspace.write")).toBe("AUTONOMOUS");
  });

  it("allows A3 campaign communication without lowering A2", () => {
    expect(getCapabilityMode("A2", "external.communicate")).toBe("CONFIRM");
    expect(getCapabilityMode("A3", "external.communicate")).toBe("AUTONOMOUS");
  });

  it("uses the strictest affected capability for a compound action", () => {
    expect(verdictForModes(["FULL", "CONFIRM", "AUTONOMOUS"])).toBe("NEEDS_CONFIRMATION");
    expect(verdictForModes(["FULL", "DENY"])).toBe("DENY");
    expect(verdictForModes(["AUTONOMOUS", "SCOPED"])).toBe("ALLOW_WITH_LIMITS");
    expect(verdictForModes(["FULL", "AUTONOMOUS"])).toBe("ALLOW");
  });

  it("accepts only content-minimized policy Decision Trace events", () => {
    const event = {
      decision_id: "decision-1",
      operation_id: "operation-1",
      project_id: "project-1",
      actor_id: "manager",
      verdict: "NEEDS_CONFIRMATION",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-1"],
      reasons: ["Owner confirmation is required."],
      policy_version: "1.1.0",
      evaluated_at: "2026-09-01T10:00:00.000Z",
      created_at: "2026-09-01T10:00:00.000Z"
    } as const;

    expect(Value.Check(PolicyDecisionTraceEventSchema, event)).toBe(true);
    expect(
      Value.Check(PolicyDecisionTraceEventSchema, {
        ...event,
        purpose: "Sensitive task content must not cross the trace contract."
      })
    ).toBe(false);
    expect(
      Value.Check(PolicyDecisionTraceListResponseSchema, {
        items: [event],
        limit: 50
      })
    ).toBe(true);
  });

  it("accepts only content-minimized recovery-required operations", () => {
    const operation = {
      operation_id: "operation-recovery-1",
      project_id: "project-1",
      actor_id: "manager",
      recovery_status: "RECOVERY_REQUIRED",
      capability_ids: ["external.communicate"],
      object_ids: ["campaign-1"],
      reasons: ["External effect was allowed."],
      policy_version: "1.1.0",
      reserved_at: "2026-09-02T04:00:00.000Z"
    } as const;

    expect(Value.Check(PolicyRecoveryRequiredOperationSchema, operation)).toBe(true);
    expect(
      Value.Check(PolicyRecoveryRequiredOperationSchema, {
        ...operation,
        idempotency_key: "private-replay-key",
        result: { sent: true },
        purpose: "Private operation content"
      })
    ).toBe(false);
    expect(
      Value.Check(PolicyRecoveryRequiredListResponseSchema, { items: [operation], limit: 50 })
    ).toBe(true);
  });

  it("accepts a complete capability profile", () => {
    expect(
      Value.Check(CapabilityProfileSchema, {
        profile_id: "profile-1",
        project_id: "project-1",
        base_level: "A2",
        grants: CAPABILITY_IDS.map((capabilityId) => ({
          capability_id: capabilityId,
          mode: AUTONOMY_MATRIX[capabilityId].A2,
          scope: [],
          conditions: []
        })),
        overrides: [],
        version: 1,
        issued_at: "2026-08-24T12:00:00Z"
      })
    ).toBe(true);
  });

  it("rejects malformed timestamps across policy authority contracts", () => {
    const profile = createCapabilityProfile({
      profileId: "profile-time",
      projectId: "project-1",
      baseLevel: "A2",
      version: 1,
      issuedAt: "2026-09-10T12:00:00.000Z"
    });
    expect(Value.Check(CapabilityProfileSchema, { ...profile, issued_at: "yesterday" })).toBe(
      false
    );
    expect(
      Value.Check(CapabilityProfileSchema, {
        ...profile,
        overrides: [
          {
            override_id: "bad-time-override",
            capability_id: "workspace.write",
            mode: "AUTONOMOUS",
            object_ids: ["project-1"],
            purpose: "Reject a malformed expiry",
            valid_until: "later",
            remaining_uses: 1
          }
        ]
      })
    ).toBe(false);

    const intent = {
      operation_id: "operation-time",
      project_id: "project-1",
      actor_id: "manager",
      capability_ids: ["external.communicate"],
      object_ids: ["recipient-1"],
      purpose: "Validate policy timestamps",
      idempotency_key: "policy-time"
    } as const;
    const verdict = {
      operation_id: intent.operation_id,
      verdict: "NEEDS_CONFIRMATION",
      evaluated_capabilities: [
        {
          capability_id: "external.communicate",
          mode: "CONFIRM",
          scope: [],
          conditions: []
        }
      ],
      permission_ids: [],
      reasons: ["Owner confirmation is required."],
      evaluated_at: "2026-09-10T12:00:00.000Z",
      policy_version: "1.1.0"
    } as const;
    expect(Value.Check(PolicyVerdictSchema, { ...verdict, evaluated_at: "not-a-time" })).toBe(
      false
    );

    const permission = {
      permission_id: "permission-time",
      version: 1,
      project_id: "project-1",
      subject_id: "manager",
      organizational_role: "account_owner",
      state: "ACTIVE",
      capabilities: [
        {
          capability_id: "external.communicate",
          mode: "AUTONOMOUS",
          scope: ["recipient-1"],
          conditions: ["owner_confirmed_operation"]
        }
      ],
      purpose: intent.purpose,
      object_ids: ["recipient-1"],
      valid_from: "2026-09-10T12:00:01.000Z",
      valid_until: "2026-09-10T12:15:00.000Z",
      limits: { money_minor: null, tokens: null, operations: 1, delegation_depth: 0 },
      parent_permission_id: null,
      approval: {
        approver_id: "owner-1",
        method: "session",
        terms_version: "policy-1.1.0",
        nonce: "nonce-time",
        approved_at: "2026-09-10T12:00:01.000Z"
      }
    } as const;
    expect(Value.Check(PermissionContractSchema, permission)).toBe(true);
    expect(Value.Check(PermissionContractSchema, { ...permission, valid_from: "now" })).toBe(false);
    expect(
      Value.Check(PermissionContractSchema, {
        ...permission,
        approval: { ...permission.approval, approved_at: "recently" }
      })
    ).toBe(false);

    const confirmation = {
      confirmation_id: "confirmation-time",
      project_id: "project-1",
      operation_id: intent.operation_id,
      actor_id: "manager",
      intent,
      verdict,
      status: "PENDING",
      challenge_nonce: "confirmation-nonce-time",
      requires_step_up: false,
      requested_at: "2026-09-10T12:00:00.000Z",
      expires_at: "2026-09-10T12:15:00.000Z",
      decided_at: null,
      decided_by: null,
      decision_reason: null
    } as const;
    expect(Value.Check(ConfirmationRequestSchema, confirmation)).toBe(true);
    expect(
      Value.Check(ConfirmationRequestSchema, { ...confirmation, expires_at: "in-15-minutes" })
    ).toBe(false);
  });

  it("accepts a non-mutating capability profile preview", () => {
    expect(
      Value.Check(CapabilityProfilePreviewResponseSchema, {
        current_version: 1,
        proposed_profile: createCapabilityProfile({
          profileId: "profile-1",
          projectId: "project-1",
          baseLevel: "A4",
          version: 2,
          issuedAt: "2026-08-31T21:45:00Z"
        }),
        requires_step_up: false
      })
    ).toBe(true);
  });

  it("accepts an active permission contract with step-up approval", () => {
    expect(
      Value.Check(PermissionContractSchema, {
        permission_id: "permission-1",
        version: 1,
        project_id: "project-1",
        subject_id: "manager",
        organizational_role: "account_owner",
        state: "ACTIVE",
        capabilities: [
          {
            capability_id: "finance.spend",
            mode: "AUTONOMOUS",
            scope: ["budget-1"],
            conditions: []
          }
        ],
        purpose: "Operate inside the approved budget",
        object_ids: ["budget-1"],
        valid_from: "2026-08-24T12:00:00Z",
        valid_until: null,
        limits: { money_minor: 100_000, tokens: null, operations: 50, delegation_depth: 1 },
        parent_permission_id: null,
        approval: {
          approver_id: "owner-1",
          method: "step_up",
          terms_version: "2026-08-24",
          nonce: "nonce-1",
          approved_at: "2026-08-24T12:00:00Z"
        }
      })
    ).toBe(true);
  });

  it("rejects unknown capabilities and incomplete verdicts", () => {
    expect(
      Value.Check(PermissionContractSchema, {
        permission_id: "permission-1",
        capability_id: "unknown.capability"
      })
    ).toBe(false);
    expect(Value.Check(PolicyVerdictSchema, { verdict: "ALLOW" })).toBe(false);
  });

  it("rejects a policy envelope that omits its auditable verdict", () => {
    expect(
      Value.Check(PolicyEvaluationEnvelopeSchema, {
        contract_version: "1.1.0",
        permission_contracts: []
      })
    ).toBe(false);
  });
});
