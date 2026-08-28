import type { AgentBlueprint } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { validateAgentDelegation } from "../src/agent-delegation.js";

const NOW = "2026-08-28T12:00:00.000Z";

const parent = (): AgentBlueprint => ({
  blueprint_id: "parent",
  version: 1,
  owner_id: "owner-1",
  project_id: "project-1",
  function_ref: { id: "manager", version: 1 },
  behavior_pattern_ref: { id: "strict-manager", version: 1 },
  model_profile_ref: { id: "cosmora-jupiter", version: 1 },
  grant: {
    project_id: "project-1",
    capability_ids: ["context.web.read", "context.project.read", "workspace.write"],
    tool_ids: ["web", "workspace"],
    data_scope_ids: ["project-memory"],
    object_ids: ["project-1", "artifact-1"],
    budget: { currency: "USD", money_minor: 1_000, tokens: 100_000, operations: 100 },
    delegation_depth: 2,
    valid_until: "2026-08-28T18:00:00.000Z"
  },
  memory_scope: { read_mode: "project_segments", source_ids: [], write_back: "result_only" },
  task_contract: "Manage the approved milestone.",
  start_condition: "Milestone approved.",
  close_conditions: ["Milestone closed."],
  created_by_actor_id: "owner-actor-1",
  created_at: NOW
});

const child = (): AgentBlueprint => ({
  ...parent(),
  blueprint_id: "child",
  function_ref: { id: "researcher", version: 1 },
  behavior_pattern_ref: { id: "skeptical-analyst", version: 1 },
  grant: {
    project_id: "project-1",
    capability_ids: ["context.web.read", "context.project.read"],
    tool_ids: ["web"],
    data_scope_ids: ["project-memory"],
    object_ids: ["project-1"],
    budget: { currency: "USD", money_minor: 200, tokens: 20_000, operations: 10 },
    delegation_depth: 1,
    valid_until: "2026-08-28T16:00:00.000Z"
  }
});

describe("validateAgentDelegation", () => {
  it("allows a strictly bounded child blueprint", () => {
    expect(validateAgentDelegation(parent(), child(), NOW)).toEqual({ allowed: true, reasons: [] });
  });

  it.each([
    ["owner", (value: AgentBlueprint): AgentBlueprint => ({ ...value, owner_id: "owner-2" })],
    ["project", (value: AgentBlueprint): AgentBlueprint => ({ ...value, project_id: "project-2" })],
    [
      "capability",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, capability_ids: [...value.grant.capability_ids, "finance.spend"] }
      })
    ],
    [
      "tool",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, tool_ids: [...value.grant.tool_ids, "payments"] }
      })
    ],
    [
      "data",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, data_scope_ids: [...value.grant.data_scope_ids, "global-memory"] }
      })
    ],
    [
      "object",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, object_ids: [...value.grant.object_ids, "artifact-2"] }
      })
    ],
    [
      "money",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, budget: { ...value.grant.budget, money_minor: 2_000 } }
      })
    ],
    [
      "tokens",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, budget: { ...value.grant.budget, tokens: 200_000 } }
      })
    ],
    [
      "operations",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, budget: { ...value.grant.budget, operations: 200 } }
      })
    ],
    [
      "delegation depth",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, delegation_depth: 2 }
      })
    ],
    [
      "expiry",
      (value: AgentBlueprint): AgentBlueprint => ({
        ...value,
        grant: { ...value.grant, valid_until: "2026-08-28T20:00:00.000Z" }
      })
    ]
  ])("rejects child expansion of %s", (_label, mutate) => {
    const result = validateAgentDelegation(parent(), mutate(child()), NOW);
    expect(result.allowed).toBe(false);
    expect(result.reasons).not.toHaveLength(0);
  });

  it("rejects delegation when the parent has no remaining depth", () => {
    const root = parent();
    root.grant.delegation_depth = 0;
    expect(validateAgentDelegation(root, child(), NOW)).toMatchObject({ allowed: false });
  });
});
