import {
  AUTONOMY_MATRIX,
  CAPABILITY_IDS,
  type AutonomyLevel,
  type CapabilityOverride,
  type CapabilityProfile,
  type PermissionContract,
  type PolicyIntent
} from "@nexus/contracts";
import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/index.js";

const NOW = "2026-08-24T12:00:00Z";

const profile = (
  level: AutonomyLevel,
  overrides: CapabilityOverride[] = []
): CapabilityProfile => ({
  profile_id: `profile-${level}`,
  project_id: "project-1",
  base_level: level,
  grants: CAPABILITY_IDS.map((capabilityId) => ({
    capability_id: capabilityId,
    mode: AUTONOMY_MATRIX[capabilityId][level],
    scope: [],
    conditions: []
  })),
  overrides,
  version: 1,
  issued_at: NOW
});

const intent = (capabilityIds: PolicyIntent["capability_ids"]): PolicyIntent => ({
  operation_id: "operation-1",
  project_id: "project-1",
  actor_id: "manager",
  capability_ids: capabilityIds,
  object_ids: ["project-1"],
  purpose: "Run a policy-engine test",
  idempotency_key: "policy-test-1"
});

const permission = (
  capabilityId: PermissionContract["capabilities"][number]["capability_id"],
  mode: PermissionContract["capabilities"][number]["mode"],
  overrides: Partial<PermissionContract> = {}
): PermissionContract => ({
  permission_id: "permission-1",
  version: 1,
  project_id: "project-1",
  subject_id: "manager",
  organizational_role: "account_owner",
  state: "ACTIVE",
  capabilities: [{ capability_id: capabilityId, mode, scope: [], conditions: [] }],
  purpose: "Owner-approved task permission",
  object_ids: [],
  valid_from: "2026-08-24T00:00:00Z",
  valid_until: null,
  limits: { money_minor: null, tokens: null, operations: null, delegation_depth: 0 },
  parent_permission_id: null,
  approval: {
    approver_id: "owner-1",
    method: "step_up",
    terms_version: "2026-08-24",
    nonce: "nonce-1",
    approved_at: "2026-08-24T00:00:00Z"
  },
  ...overrides
});

describe("evaluatePolicy", () => {
  it("denies an A0 web action", () => {
    const verdict = evaluatePolicy(
      { intent: intent(["context.web.read"]), profile: profile("A0"), permissionContracts: [] },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("DENY");
  });

  it("allows an A2 persistent workspace action", () => {
    const verdict = evaluatePolicy(
      { intent: intent(["workspace.write"]), profile: profile("A2"), permissionContracts: [] },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("ALLOW");
  });

  it("uses the strictest capability in a compound A3 action", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent(["external.communicate", "contract.finalize"]),
        profile: profile("A3"),
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("NEEDS_CONFIRMATION");
  });

  it("applies an active owner permission to the intended actor", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent(["contract.finalize"]),
        profile: profile("A3"),
        permissionContracts: [permission("contract.finalize", "AUTONOMOUS")]
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("ALLOW");
    expect(verdict.permission_ids).toEqual(["permission-1"]);
  });

  it("ignores expired and revoked permission contracts", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent(["contract.finalize"]),
        profile: profile("A3"),
        permissionContracts: [
          permission("contract.finalize", "AUTONOMOUS", {
            state: "REVOKED",
            valid_until: "2026-08-24T01:00:00Z"
          })
        ]
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("NEEDS_CONFIRMATION");
    expect(verdict.permission_ids).toEqual([]);
  });

  it("does not leak an object-scoped permission to another object", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent(["contract.finalize"]),
        profile: profile("A3"),
        permissionContracts: [
          permission("contract.finalize", "AUTONOMOUS", { object_ids: ["contract-2"] })
        ]
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("NEEDS_CONFIRMATION");
  });

  it("lets a profile override reduce autonomy", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent(["external.communicate"]),
        profile: profile("A5", [
          {
            override_id: "owner-stop",
            capability_id: "external.communicate",
            mode: "DENY",
            object_ids: ["project-1"],
            purpose: "Pause outbound communication",
            valid_until: null,
            remaining_uses: null
          }
        ]),
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("DENY");
  });

  it("applies a named A5 conditional expansion", () => {
    const verdict = evaluatePolicy(
      { intent: intent(["production.deploy"]), profile: profile("A5"), permissionContracts: [] },
      {
        evaluatedAt: NOW,
        activeConditionIds: ["subsequent_release_after_approved_first_release"]
      }
    );
    expect(verdict.verdict).toBe("ALLOW");
  });

  it("denies cross-project evaluation", () => {
    const crossProjectIntent = { ...intent(["workspace.write"]), project_id: "project-2" };
    const verdict = evaluatePolicy(
      { intent: crossProjectIntent, profile: profile("A6"), permissionContracts: [] },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("DENY");
  });

  it("pauses an ambiguous profile with duplicate grants", () => {
    const ambiguous = profile("A2");
    const first = ambiguous.grants[0];
    if (first === undefined) throw new Error("Fixture has no grants");
    ambiguous.grants.push(first);
    const verdict = evaluatePolicy(
      { intent: intent([first.capability_id]), profile: ambiguous, permissionContracts: [] },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("PAUSE");
  });

  it("pauses conflicting active overrides", () => {
    const overrideBase = {
      capability_id: "finance.spend" as const,
      object_ids: ["project-1"],
      purpose: "Temporary budget decision",
      valid_until: null,
      remaining_uses: null
    };
    const verdict = evaluatePolicy(
      {
        intent: intent(["finance.spend"]),
        profile: profile("A4", [
          { ...overrideBase, override_id: "allow-spend", mode: "FULL" },
          { ...overrideBase, override_id: "stop-spend", mode: "DENY" }
        ]),
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("PAUSE");
  });

  it("keeps every A6 capability fully autonomous", () => {
    const verdict = evaluatePolicy(
      { intent: intent([...CAPABILITY_IDS]), profile: profile("A6"), permissionContracts: [] },
      { evaluatedAt: NOW }
    );
    expect(verdict.verdict).toBe("ALLOW");
    expect(verdict.evaluated_capabilities.every((grant) => grant.mode === "FULL")).toBe(true);
  });
});
