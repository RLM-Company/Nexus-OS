import { describe, expect, it } from "vitest";
import {
  accountableManager,
  changeStarsOrg,
  createStarsOrg,
  delegateMission,
  resolveAssignee,
  StarsOrgConflict,
  type StarsOrgNode
} from "../src/index.js";
import { applyStarsMissionEvent, createStarsMission } from "../src/stars-mission.js";

const at = "2026-11-27T10:00:00.000Z";
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

const roster = (): StarsOrgNode[] => [
  node("owner", "owner", null, ["*"], ["project-a", "project-b"]),
  node("chief", "chief", "owner", ["*"], ["project-a", "project-b"]),
  node("sub-a", "submanager", "chief", ["research"], ["project-a"]),
  node("sub-b", "submanager", "chief", ["delivery"], ["project-b"]),
  node("alice", "executor", "sub-a", ["research"], []),
  node("bob", "executor", "sub-b", ["delivery"], []),
  node("senior", "senior", "chief", ["review"], [])
];

describe("Stars org hierarchy", () => {
  it("keeps one accountable manager per project with multiple manager levels", () => {
    const org = createStarsOrg("stars-team", roster());
    expect(org.version).toBe(1);
    expect(accountableManager(org, "project-a")?.id).toBe("sub-a");
    expect(accountableManager(org, "project-b")?.id).toBe("sub-b");
    expect(resolveAssignee(org, "sub-a", "research")?.id).toBe("alice");
    expect(resolveAssignee(org, "sub-b", "delivery")?.id).toBe("bob");
  });

  it("rejects two accountable owners of the same project", () => {
    const invalid = roster();
    invalid.push(node("sub-c", "submanager", "chief", ["research"], ["project-a"]));
    expect(() => createStarsOrg("stars-team", invalid)).toThrow(StarsOrgConflict);
    try {
      createStarsOrg("stars-team", invalid);
    } catch (error) {
      expect((error as StarsOrgConflict).code).toBe("DOUBLE_OWNER");
    }
  });

  it("advances versions, preserves removed history and rejects stale changes", () => {
    const first = createStarsOrg("stars-team", roster());
    const second = changeStarsOrg(first, 1, [
      { op: "remove", node: { ...roster()[4]!, status: "removed" } },
      { op: "add", node: node("carol", "executor", "sub-a", ["research"], []) }
    ]);
    expect(second.version).toBe(2);
    expect(second.checksum).not.toBe(first.checksum);
    expect(second.nodes.find((n) => n.id === "alice")?.status).toBe("removed");
    expect(resolveAssignee(second, "sub-a", "research")?.id).toBe("carol");
    expect(first.nodes.find((n) => n.id === "alice")?.status).toBe("active");
    expect(() => changeStarsOrg(second, 1, [])).toThrow("STALE_VERSION");
  });

  it("delegates through the accountable manager into real WorkDAG node inputs", () => {
    const org = createStarsOrg("stars-team", roster());
    let mission = createStarsMission({ id: "m-delegate", team_scope: "stars-team" });
    mission = applyStarsMissionEvent(mission, {
      type: "brief",
      goal: "Сравнить предложения",
      author: "owner",
      responsible: "sub-a",
      input_versions: ["materials@3"],
      criteria: ["доставка отдельной строкой"],
      acceptance_rules: ["проверка старшим"]
    });
    mission = applyStarsMissionEvent(mission, {
      type: "plan",
      agents: [
        { id: "manager", role: "manager", task: "координировать", context_scopes: [] },
        { id: "alice", role: "executor", task: "извлечь", context_scopes: [] }
      ],
      dependencies: {}
    });
    const plan = delegateMission(mission, org, "project-a", { alice: "research" });
    expect(plan.composition_version).toBe(1);
    expect(plan.mission_version).toBe(mission.version);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0]).toMatchObject({ id: "alice", depends_on: [] });
    expect(plan.nodes[0]!.goal).toContain("materials@3");
    expect(plan.nodes[0]!.goal).toContain("доставка отдельной строкой");
    expect(plan.skipped).toEqual([]);
    // Ambiguous or unauthorized executor is skipped with a visible reason.
    const blocked = delegateMission(mission, org, "project-a", { alice: "delivery" });
    expect(blocked.nodes).toEqual([]);
    expect(blocked.skipped[0]!.reason).toContain("зоне");
  });
});
