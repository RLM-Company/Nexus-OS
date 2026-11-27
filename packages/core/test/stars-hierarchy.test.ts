import { describe, expect, it } from "vitest";
import {
  accountableManager,
  changeStarsOrg,
  createStarsOrg,
  resolveAssignee,
  StarsOrgConflict,
  type StarsOrgNode
} from "../src/stars-hierarchy.js";

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
});
