import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  AgentBlueprintSchema,
  AgentHandoffSchema,
  AgentInstanceSchema,
  BehaviorPatternSchema,
  type AgentBlueprint
} from "../src/index.js";

const blueprint = (patternId: string): AgentBlueprint => ({
  blueprint_id: `blueprint-${patternId}`,
  version: 1,
  owner_id: "owner-1",
  project_id: "project-1",
  function_ref: { id: "researcher", version: 1 },
  behavior_pattern_ref: { id: patternId, version: 3 },
  model_profile_ref: { id: "cosmora-jupiter", version: 1 },
  grant: {
    project_id: "project-1",
    capability_ids: ["context.web.read", "context.project.read"],
    tool_ids: ["web-research"],
    data_scope_ids: ["project-memory:market"],
    object_ids: ["project-1"],
    budget: { currency: "USD", money_minor: 500, tokens: 50_000, operations: 20 },
    delegation_depth: 1,
    valid_until: "2026-08-28T14:00:00.000Z"
  },
  memory_scope: {
    read_mode: "project_segments",
    source_ids: ["project-memory:market"],
    write_back: "result_and_evidence"
  },
  task_contract: "Return cited market findings and unresolved questions.",
  start_condition: "The research milestone is ready.",
  close_conditions: ["The result and evidence are accepted."],
  created_by_actor_id: "owner-actor-1",
  created_at: "2026-08-28T12:00:00.000Z"
});

describe("Agent Studio contracts", () => {
  it("keeps function and behaviour pattern independently replaceable", () => {
    const skeptical = blueprint("skeptical-analyst");
    const academic = blueprint("careful-academic");

    expect(Value.Check(AgentBlueprintSchema, skeptical)).toBe(true);
    expect(Value.Check(AgentBlueprintSchema, academic)).toBe(true);
    expect(skeptical.function_ref).toEqual(academic.function_ref);
    expect(skeptical.behavior_pattern_ref).not.toEqual(academic.behavior_pattern_ref);
  });

  it("does not let a behaviour pattern carry permissions or budget", () => {
    const pattern = {
      pattern_id: "skeptical-analyst",
      version: 3,
      scope: "owner",
      owner_id: "owner-1",
      project_id: null,
      name: "Skeptical analyst",
      description: "Tests claims and records uncertainty.",
      instructions: "Challenge unsupported claims and cite evidence.",
      allowed_function_ids: ["researcher", "analyst"],
      known_limitations: ["May over-emphasize downside risk."],
      test_status: "verified",
      created_by_actor_id: "owner-actor-1",
      created_at: "2026-08-28T12:00:00.000Z",
      archived_at: null
    };

    expect(Value.Check(BehaviorPatternSchema, pattern)).toBe(true);
    expect(
      Value.Check(BehaviorPatternSchema, {
        ...pattern,
        capability_ids: ["finance.spend"],
        tool_ids: ["payments"],
        budget: { money_minor: 1_000_000 }
      })
    ).toBe(false);
  });

  it("captures temporary lifecycle and a bounded replacement handoff", () => {
    const instance = {
      instance_id: "agent-instance-1",
      blueprint: blueprint("skeptical-analyst"),
      parent_instance_id: null,
      status: "active",
      created_at: "2026-08-28T12:00:00.000Z",
      updated_at: "2026-08-28T12:01:00.000Z",
      closed_at: null
    };
    const handoff = {
      handoff_id: "handoff-1",
      project_id: "project-1",
      from_instance_id: "agent-instance-1",
      to_instance_id: "agent-instance-2",
      summary: "Evidence collected; pricing remains uncertain.",
      artifact_ids: ["artifact-market-table"],
      open_questions: ["Confirm current provider pricing."],
      known_errors: [],
      created_at: "2026-08-28T13:00:00.000Z"
    };

    expect(Value.Check(AgentInstanceSchema, instance)).toBe(true);
    expect(Value.Check(AgentHandoffSchema, handoff)).toBe(true);
  });
});
