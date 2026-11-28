/** Stars permanent team hierarchy — pure core model.
 * A project/business has exactly one accountable manager; multiple manager
 * levels are explicit, composition changes are versioned, and a stale version
 * cannot overwrite current state. This module is not a second scheduler. */
import { createHash } from "node:crypto";

export type StarsOrgRole = "owner" | "chief" | "submanager" | "executor" | "senior";
export type StarsOrgNode = {
  id: string;
  role: StarsOrgRole;
  manager_id: string | null;
  responsibility_zones: string[];
  project_ids: string[];
  status: "active" | "removed";
  effective_from: string;
};
export type StarsOrgSnapshot = {
  team_scope: string;
  version: number;
  nodes: StarsOrgNode[];
  checksum: string;
};
export class StarsOrgConflict extends Error {
  constructor(readonly code: "STALE_VERSION" | "DOUBLE_OWNER" | "INVALID_ORG" | "UNKNOWN_MANAGER") {
    super(code);
  }
}
const digest = (nodes: StarsOrgNode[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...nodes]
          .filter((node) => node.status === "active")
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((node) => ({
            id: node.id,
            role: node.role,
            manager_id: node.manager_id,
            zones: [...node.responsibility_zones].sort(),
            projects: [...node.project_ids].sort(),
            effective_from: node.effective_from
          }))
      ),
      "utf8"
    )
    .digest("hex");

function validate(teamScope: string, nodes: StarsOrgNode[]): void {
  if (!teamScope || !nodes.length) throw new StarsOrgConflict("INVALID_ORG");
  const ids = new Set(nodes.filter((node) => node.status === "active").map((node) => node.id));
  if (ids.size !== nodes.filter((node) => node.status === "active").length)
    throw new StarsOrgConflict("INVALID_ORG");
  const owners = new Map<string, string>();
  for (const node of nodes) {
    if (node.status !== "active") continue;
    if (node.manager_id && !ids.has(node.manager_id)) throw new StarsOrgConflict("UNKNOWN_MANAGER");
    for (const project of node.project_ids) {
      // Oversight scope (owner/chief) is not direct ownership; only managers
      // assigned to a concrete project can be its single accountable owner.
      if (node.role !== "submanager") continue;
      const previous = owners.get(project);
      if (previous && previous !== node.id) throw new StarsOrgConflict("DOUBLE_OWNER");
      owners.set(project, node.id);
    }
  }
}

/** Build the first immutable snapshot. Manager ids must exist when referenced. */
export function createStarsOrg(teamScope: string, nodes: StarsOrgNode[]): StarsOrgSnapshot {
  validate(teamScope, nodes);
  return { team_scope: teamScope, version: 1, nodes, checksum: digest(nodes) };
}

/** Change the roster only from the exact current version. Removing an agent
 * keeps the old node as history, so prior missions still resolve their author. */
export function changeStarsOrg(
  current: StarsOrgSnapshot,
  expectedVersion: number,
  changes: Array<{ op: "add" | "update" | "remove"; node: StarsOrgNode }>
): StarsOrgSnapshot {
  if (current.version !== expectedVersion) throw new StarsOrgConflict("STALE_VERSION");
  const byId = new Map(current.nodes.map((node) => [node.id, node]));
  for (const change of changes) {
    if (change.op === "remove") {
      const existing = byId.get(change.node.id);
      if (!existing) throw new StarsOrgConflict("INVALID_ORG");
      byId.set(change.node.id, { ...existing, status: "removed" });
      continue;
    }
    byId.set(change.node.id, change.node);
  }
  const nodes = [...byId.values()];
  validate(current.team_scope, nodes);
  return {
    team_scope: current.team_scope,
    version: current.version + 1,
    nodes,
    checksum: digest(nodes)
  };
}

/** The single accountable manager for a project in a given snapshot. */
export function accountableManager(
  snapshot: StarsOrgSnapshot,
  projectId: string
): StarsOrgNode | null {
  const candidates = snapshot.nodes.filter(
    (node) =>
      node.status === "active" &&
      node.project_ids.includes(projectId) &&
      ["submanager"].includes(node.role)
  );
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Delegation target: direct report of the manager with the required zone. */
export function resolveAssignee(
  snapshot: StarsOrgSnapshot,
  managerId: string,
  zone: string
): StarsOrgNode | null {
  const matches = snapshot.nodes.filter(
    (node) =>
      node.status === "active" &&
      node.manager_id === managerId &&
      node.responsibility_zones.includes(zone) &&
      node.role === "executor"
  );
  return matches.length === 1 ? matches[0]! : null;
}
