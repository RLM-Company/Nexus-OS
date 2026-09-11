import {
  AUTONOMY_MATRIX,
  CAPABILITY_IDS,
  type AutonomyLevel,
  type CapabilityOverride,
  type CapabilityProfile,
  type PermissionContract,
  type PolicyIntent
} from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/index.js";

const NOW = "2026-09-09T18:00:00.000Z";

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

const intent = (capabilityId: PolicyIntent["capability_ids"][number]): PolicyIntent => ({
  operation_id: `operation-${capabilityId}`,
  project_id: "project-1",
  actor_id: "manager",
  capability_ids: [capabilityId],
  object_ids: ["project-1"],
  purpose: "Validate canonical policy profile integrity",
  idempotency_key: `policy-profile-integrity-${capabilityId}`
});

const permission = (
  capabilityId: PermissionContract["capabilities"][number]["capability_id"],
  mode: PermissionContract["capabilities"][number]["mode"]
): PermissionContract => ({
  permission_id: "permission-1",
  version: 1,
  project_id: "project-1",
  subject_id: "manager",
  organizational_role: "account_owner",
  state: "ACTIVE",
  capabilities: [{ capability_id: capabilityId, mode, scope: [], conditions: [] }],
  purpose: "Validate canonical policy profile integrity",
  object_ids: [],
  valid_from: "2026-09-09T17:00:00.000Z",
  valid_until: "2026-09-09T19:00:00.000Z",
  limits: { money_minor: null, tokens: null, operations: 1, delegation_depth: 0 },
  parent_permission_id: null,
  approval: {
    approver_id: "owner-1",
    method: "step_up",
    terms_version: "policy-1.1.0",
    nonce: "nonce-policy-integrity",
    approved_at: "2026-09-09T17:00:00.000Z"
  }
});

const replaceBaseMode = (
  value: CapabilityProfile,
  capabilityId: PolicyIntent["capability_ids"][number],
  mode: CapabilityProfile["grants"][number]["mode"]
): CapabilityProfile => ({
  ...value,
  grants: value.grants.map((grant) =>
    grant.capability_id === capabilityId ? { ...grant, mode } : grant
  )
});

describe("policy profile base grant integrity", () => {
  it("pauses when a low-autonomy profile contains an unauthorized permissive base grant", () => {
    const tampered = replaceBaseMode(profile("A0"), "finance.credit", "FULL");
    const verdict = evaluatePolicy(
      {
        intent: intent("finance.credit"),
        profile: tampered,
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("PAUSE");
    expect(verdict.evaluated_capabilities).toEqual([
      expect.objectContaining({ capability_id: "finance.credit", mode: "DENY" })
    ]);
    expect(verdict.reasons).toContain(
      "Profile profile-A0 base grant for finance.credit does not match A0."
    );
  });

  it("pauses the whole evaluation when an unrelated base grant is corrupted", () => {
    const tampered = replaceBaseMode(profile("A2"), "finance.credit", "FULL");
    const verdict = evaluatePolicy(
      {
        intent: intent("workspace.write"),
        profile: tampered,
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("PAUSE");
    expect(verdict.evaluated_capabilities).toEqual([
      expect.objectContaining({ capability_id: "workspace.write", mode: "DENY" })
    ]);
    expect(verdict.reasons.join(" ")).toContain("finance.credit");
  });

  it("pauses the whole evaluation when an unrelated capability grant is duplicated", () => {
    const tampered = profile("A2");
    const duplicate = tampered.grants.find(
      (grant) => grant.capability_id === "external.communicate"
    );
    if (duplicate === undefined) throw new Error("Fixture grant is missing");
    tampered.grants.push({ ...duplicate });

    const verdict = evaluatePolicy(
      {
        intent: intent("workspace.write"),
        profile: tampered,
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("PAUSE");
    expect(verdict.reasons.join(" ")).toContain(
      "Expected exactly one profile grant for external.communicate; found 2."
    );
  });

  it("pauses when a base grant is made more restrictive outside the override mechanism", () => {
    const tampered = replaceBaseMode(profile("A5"), "external.communicate", "DENY");
    const verdict = evaluatePolicy(
      {
        intent: intent("external.communicate"),
        profile: tampered,
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("PAUSE");
    expect(verdict.evaluated_capabilities).toEqual([
      expect.objectContaining({ capability_id: "external.communicate", mode: "DENY" })
    ]);
  });

  it("still allows a canonical restrictive override to lower authority", () => {
    const restricted = profile("A5", [
      {
        override_id: "pause-outbound",
        capability_id: "external.communicate",
        mode: "DENY",
        object_ids: ["project-1"],
        purpose: "Validate canonical policy profile integrity",
        valid_until: null,
        remaining_uses: null
      }
    ]);

    const verdict = evaluatePolicy(
      {
        intent: intent("external.communicate"),
        profile: restricted,
        permissionContracts: []
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("DENY");
    expect(verdict.reasons).toContain("Override pause-outbound set the final mode to DENY.");
  });

  it("still allows a bounded permission contract to expand a canonical base grant", () => {
    const verdict = evaluatePolicy(
      {
        intent: intent("contract.finalize"),
        profile: profile("A3"),
        permissionContracts: [permission("contract.finalize", "AUTONOMOUS")]
      },
      { evaluatedAt: NOW }
    );

    expect(verdict.verdict).toBe("ALLOW");
    expect(verdict.permission_ids).toEqual(["permission-1"]);
  });
});
