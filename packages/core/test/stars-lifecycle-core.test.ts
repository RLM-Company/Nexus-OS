import { describe, expect, it } from "vitest";
import {
  applyStarsMissionEvent,
  buildStarsHandoff,
  cancelLease,
  createStarsMission,
  createStarsOrg,
  heartbeat,
  requestRunnerLease,
  shouldWakeStars,
  StarsRunnerConflict,
  type StarsOrgNode
} from "../src/index.js";

const at = "2026-11-27T12:00:00.000Z";
const node = (
  id: string,
  role: StarsOrgNode["role"],
  manager_id: string | null,
  zones: string[],
  projects: string[]
): StarsOrgNode => ({
  id,
  role,
  manager_id,
  responsibility_zones: zones,
  project_ids: projects,
  status: "active",
  effective_from: at
});
const mission = () => {
  let state = createStarsMission({ id: "m-lifecycle", team_scope: "team" });
  state = applyStarsMissionEvent(state, {
    type: "brief",
    goal: "Сравнить поставщиков",
    author: "owner",
    responsible: "sub",
    input_versions: ["materials@2"],
    criteria: ["доставка отдельной строкой"],
    acceptance_rules: ["проверка старшим"]
  });
  return applyStarsMissionEvent(state, {
    type: "plan",
    agents: [
      { id: "manager", role: "manager", task: "координировать", context_scopes: ["team"] },
      { id: "alice", role: "executor", task: "извлечь", context_scopes: ["team", "alice-private"] }
    ],
    dependencies: {}
  });
};

describe("Stars lifecycle core", () => {
  it("builds a handoff packet with versions, unfinished work and exact scopes", () => {
    const org = createStarsOrg("team", [
      node("chief", "chief", null, ["*"], ["p"]),
      node("sub", "submanager", "chief", ["research"], ["p"]),
      node("alice", "executor", "sub", ["research"], [])
    ]);
    let state = mission();
    state = applyStarsMissionEvent(state, { type: "fail", agent_id: "alice", reason: "PROVIDER" });
    const packet = buildStarsHandoff(state, org, "alice", "alice2", at);
    expect(packet).toMatchObject({
      format: "kosmora.stars-handoff.v1",
      mission_version: state.version,
      composition_version: 1,
      from: "alice",
      to: "alice2"
    });
    expect(packet.unfinished[0]).toMatchObject({ task: "извлечь", reason: "executor_failed" });
    expect(packet.context_scopes).toEqual(["team", "alice-private"]);
    expect(packet.context_scopes).not.toContain("manager-private");
  });

  it("wakes only for relevant in-progress missions and cheap conditions", () => {
    const state = mission();
    expect(
      shouldWakeStars(state, { kind: "event", source_id: "e", project_id: "team", at }).wake
    ).toBe(true);
    expect(
      shouldWakeStars(state, {
        kind: "condition",
        source_id: "c",
        project_id: "team",
        at,
        condition: "pending_result"
      }).wake
    ).toBe(true);
    const completed = applyStarsMissionEvent(state, { type: "cancel" });
    expect(
      shouldWakeStars(completed, { kind: "event", source_id: "e", project_id: "team", at }).wake
    ).toBe(false);
  });

  it("keeps runner selection explicit with one active lease and cancel", () => {
    const lease = requestRunnerLease({
      lease_id: "lease-1",
      runner: "remote",
      task_id: "task-1",
      holder: "stars-agent",
      expires_at: "2026-11-27T13:00:00.000Z",
      active: []
    });
    expect(lease).toMatchObject({ runner: "remote", status: "requested" });
    expect(heartbeat(lease, at).status).toBe("active");
    expect(() =>
      requestRunnerLease({
        lease_id: "lease-2",
        runner: "local",
        task_id: "task-1",
        holder: "other",
        expires_at: at,
        active: [heartbeat(lease, at)]
      })
    ).toThrow(StarsRunnerConflict);
    expect(cancelLease(heartbeat(lease, at)).status).toBe("cancelled");
  });
});
