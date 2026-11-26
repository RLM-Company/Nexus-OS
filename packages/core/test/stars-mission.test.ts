import { describe, expect, it } from "vitest";
import {
  applyStarsMissionEvent,
  canReadContext,
  createStarsMission,
  StarsMissionConflict
} from "../src/stars-mission.js";

const brief = (goal: string) =>
  applyStarsMissionEvent(createStarsMission({ id: "m-1", team_scope: "team-stars" }), {
    type: "brief",
    goal
  });

const plan = (state: ReturnType<typeof brief>) =>
  applyStarsMissionEvent(state, {
    type: "plan",
    agents: [
      {
        id: "manager",
        role: "manager",
        task: "координировать",
        context_scopes: ["manager-private"]
      },
      { id: "a1", role: "executor", task: "извлечь", context_scopes: ["a1-private"] },
      { id: "a2", role: "executor", task: "сверить", context_scopes: ["a2-private"] }
    ],
    dependencies: { a2: ["a1"] }
  });

describe("Stars team mission", () => {
  it("assigns a manager and two executors with dependencies", () => {
    const state = plan(brief("Сравнить предложения"));
    expect(state.stage).toBe("working");
    expect(state.agents.map((a) => a.role)).toEqual(["manager", "executor", "executor"]);
    expect(state.dependencies.a2).toEqual(["a1"]);
  });

  it("keeps personal contexts private but shares the team scope", () => {
    const state = plan(brief("Сравнить предложения"));
    expect(canReadContext(state, "a1", "team-stars")).toBe(true);
    expect(canReadContext(state, "a1", "a1-private")).toBe(true);
    expect(canReadContext(state, "a1", "a2-private")).toBe(false);
    expect(
      applyStarsMissionEvent(state, {
        type: "message",
        from: "a1",
        to: "a2",
        text: "нельзя",
        expected_version: state.version
      })
    ).toBe(state);
  });

  it("preserves unfinished work on failure and hands it to a replacement", () => {
    let state = plan(brief("Сравнить предложения"));
    state = applyStarsMissionEvent(state, {
      type: "fail",
      agent_id: "a1",
      reason: "PROVIDER_ERROR"
    });
    expect(state.agents.find((a) => a.id === "a1")?.handoff).toBe("извлечь");
    state = applyStarsMissionEvent(state, {
      type: "replace",
      failed_agent_id: "a1",
      replacement_id: "a1b"
    });
    const replacement = state.agents.find((a) => a.id === "a1b");
    expect(replacement?.task).toBe("извлечь");
    expect(replacement?.handoff).toBe("извлечь");
    expect(state.dependencies.a2).toEqual(["a1b"]);
  });

  it("requires verification before the senior combines the result", () => {
    let state = plan(brief("Сравнить предложения"));
    state = applyStarsMissionEvent(state, {
      type: "result",
      agent_id: "a1",
      summary: "извлечено",
      artifact_ref: "artifact-1"
    });
    state = applyStarsMissionEvent(state, {
      type: "result",
      agent_id: "a2",
      summary: "сверено",
      artifact_ref: "artifact-2"
    });
    expect(
      applyStarsMissionEvent(state, {
        type: "combine",
        summary: "итог",
        expected_version: state.version
      })
    ).toBe(state);
    state = applyStarsMissionEvent(state, {
      type: "verify",
      agent_id: "a1",
      verdict: "verified",
      verified_by: "manager"
    });
    state = applyStarsMissionEvent(state, {
      type: "verify",
      agent_id: "a2",
      verdict: "verified",
      verified_by: "manager"
    });
    state = applyStarsMissionEvent(state, { type: "combine", summary: "итог" });
    expect(state.stage).toBe("completed");
    expect(state.combined_result).toBe("итог");
  });

  it("keeps accepted results through pause, resume and cancel", () => {
    let state = plan(brief("Сравнить предложения"));
    state = applyStarsMissionEvent(state, {
      type: "result",
      agent_id: "a1",
      summary: "извлечено"
    });
    const accepted = state.results[0]!;
    state = applyStarsMissionEvent(state, { type: "pause" });
    expect(state.stage).toBe("paused");
    state = applyStarsMissionEvent(state, { type: "resume" });
    expect(state.stage).toBe("working");
    state = applyStarsMissionEvent(state, { type: "cancel" });
    expect(state.stage).toBe("cancelled");
    expect(state.results[0]).toEqual(accepted);
  });

  it("rejects a stale control event", () => {
    const state = plan(brief("Сравнить предложения"));
    expect(() =>
      applyStarsMissionEvent(state, { type: "pause", expected_version: state.version + 1 })
    ).toThrow(StarsMissionConflict);
  });
});
