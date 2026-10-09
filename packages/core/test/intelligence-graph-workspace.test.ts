import { describe, expect, it } from "vitest";
import type {
  IntelligenceGraphRevisionInfo,
  IntelligenceGraphWorkspace,
  IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";
import {
  IntelligenceGraphWorkspaceError,
  IntelligenceGraphWorkspaceService
} from "../src/index.js";

class MemoryRepository implements IntelligenceGraphWorkspaceRepository {
  readonly current = new Map<string, IntelligenceGraphWorkspace>();
  readonly revisions = new Map<string, IntelligenceGraphWorkspace[]>();
  private key(owner: string, project: string, graph: string) {
    return `${owner}|${project}|${graph}`;
  }
  create(record: IntelligenceGraphWorkspace) {
    if (record.owner_id !== "owner-a" || record.project_id !== "project-a") return null;
    const key = this.key(record.owner_id, record.project_id, record.graph_id);
    this.current.set(key, structuredClone(record));
    this.revisions.set(key, [structuredClone(record)]);
    return structuredClone(record);
  }
  get(owner: string, project: string, graph: string) {
    return structuredClone(this.current.get(this.key(owner, project, graph)) ?? null);
  }
  list(owner: string, project: string, limit: number) {
    return [...this.current.entries()]
      .filter(([key]) => key.startsWith(`${owner}|${project}|`))
      .map(([, value]) => structuredClone(value))
      .slice(0, limit);
  }
  getRevision(owner: string, project: string, graph: string, revision: number) {
    return structuredClone(this.revisions.get(this.key(owner, project, graph))
      ?.find((item) => item.revision === revision) ?? null);
  }
  listRevisions(owner: string, project: string, graph: string, limit: number):
    IntelligenceGraphRevisionInfo[] {
    return (this.revisions.get(this.key(owner, project, graph)) ?? [])
      .slice(-limit).reverse().map((item) => ({
        revision: item.revision,
        created_at: item.updated_at,
        summary: "test",
        restored_from_revision: item.restored_from_revision
      }));
  }
  save(record: IntelligenceGraphWorkspace, expected: number) {
    const key = this.key(record.owner_id, record.project_id, record.graph_id);
    if (this.current.get(key)?.revision !== expected) return null;
    this.current.set(key, structuredClone(record));
    this.revisions.get(key)?.push(structuredClone(record));
    return structuredClone(record);
  }
}

const suite = () => {
  const repository = new MemoryRepository();
  let tick = 0;
  const service = new IntelligenceGraphWorkspaceService(
    repository, () => new Date(Date.UTC(2026, 9, 9, 0, 0, tick++)).toISOString()
  );
  return { service, repository };
};

const expectCode = (fn: () => unknown, code: IntelligenceGraphWorkspaceError["code"]) => {
  try { fn(); throw new Error("Expected graph error"); }
  catch (error) {
    expect(error).toBeInstanceOf(IntelligenceGraphWorkspaceError);
    expect((error as IntelligenceGraphWorkspaceError).code).toBe(code);
  }
};

describe("editable graph workspace", () => {
  it("creates/opens a genuinely empty graph; does not fabricate nodes", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Реальная архитектура");
    expect(graph).toMatchObject({ revision: 1, nodes: [], edges: [], records: [] });
    expect(service.list("owner-a", "project-a")).toHaveLength(1);
    expect(service.get("owner-a", "project-a", graph.graph_id)).toEqual(graph);
    expect(service.revisions("owner-a", "project-a", graph.graph_id)).toHaveLength(1);
  });

  it("creates owner-entered nodes and relations, explains candidate evidence without promotion", () => {
    const { service } = suite();
    const empty = service.create("owner-a", "project-a", "Architecture");
    const first = service.edit("owner-a", "project-a", empty.graph_id, 1, {
      kind: "add_node", node_kind: "Claim", label: "Manager", detail: "Manual claim"
    });
    const second = service.edit("owner-a", "project-a", empty.graph_id, 2, {
      kind: "add_node", node_kind: "Source", label: "Policy", detail: "Manual source"
    });
    const from = { id: first.nodes[0]!.node_id, version: 1 };
    const to = { id: second.nodes[1]!.node_id, version: 1 };
    const linked = service.edit("owner-a", "project-a", empty.graph_id, 3, {
      kind: "add_edge", relation: "REFERENCES", from, to
    });
    expect(linked.edges).toHaveLength(1);
    expect(linked.edges[0]?.verification_status).toBe("discovered");
    expect(linked.nodes.every((item) => item.verification_status === "discovered")).toBe(true);
    const explanation = service.explain("owner-a", "project-a", empty.graph_id, "Manager");
    expect(explanation.readiness).toBe("abstain");
    expect(explanation.relationships).toEqual([
      expect.objectContaining({
        relation: "REFERENCES", verified: false,
        description: "Manager — ссылается на — Policy"
      })
    ]);
    expect(explanation.matched_nodes.some((item) => item.label === "Manager")).toBe(true);
    expect(explanation.explanation).toContain("Недостаточно");
  });

  it("revises an edge with immutable versions, removes and restores graph history", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Versions");
    const a = service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "add_node", node_kind: "Claim", label: "Alpha", detail: "Original"
    });
    const b = service.edit("owner-a", "project-a", graph.graph_id, 2, {
      kind: "add_node", node_kind: "Claim", label: "Beta", detail: "Second"
    });
    const c = service.edit("owner-a", "project-a", graph.graph_id, 3, {
      kind: "add_node", node_kind: "Claim", label: "Gamma", detail: "Third"
    });
    const from = { id: a.nodes[0]!.node_id, version: 1 };
    const to = { id: b.nodes[1]!.node_id, version: 1 };
    const next = { id: c.nodes[2]!.node_id, version: 1 };
    const linked = service.edit("owner-a", "project-a", graph.graph_id, 4, {
      kind: "add_edge", relation: "SUPPORTS", from, to
    });
    const edgeId = linked.edges[0]!.edge_id;
    const changed = service.edit("owner-a", "project-a", graph.graph_id, 5, {
      kind: "revise_edge", edge_id: edgeId, from, to: next
    });
    expect(changed.edges.map((edge) => [edge.edge_version, edge.verification_status]))
      .toEqual([[1, "superseded"], [2, "discovered"]]);
    expect(changed.edges[1]?.supersedes).toEqual({ id: edgeId, version: 1 });
    const deleted = service.edit("owner-a", "project-a", graph.graph_id, 6, {
      kind: "remove_edge", edge_id: edgeId
    });
    expect(deleted.edges[1]?.verification_status).toBe("deleted");
    const restored = service.restore("owner-a", "project-a", graph.graph_id, 7, 5);
    expect(restored.revision).toBe(8);
    expect(restored.restored_from_revision).toBe(5);
    expect(restored.edges).toHaveLength(1);
    expect(restored.edges[0]?.verification_status).toBe("discovered");
    expect(service.revisions("owner-a", "project-a", graph.graph_id)).toHaveLength(8);
    expectCode(() => service.edit("owner-a", "project-a", graph.graph_id, 7, {
      kind: "add_node", node_kind: "Entity", label: "stale", detail: "stale"
    }), "REVISION_CONFLICT");
  });

  it("fails closed for wrong owner/project, invalid edges, input limits and foreign references", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Owner only");
    expectCode(() => service.get("owner-b", "project-a", graph.graph_id), "NOT_FOUND");
    expectCode(() => service.get("owner-a", "project-b", graph.graph_id), "NOT_FOUND");
    expect(service.list("owner-b", "project-a")).toEqual([]);
    expectCode(() => service.create("owner-b", "project-a", "Hidden"), "NOT_FOUND");
    expectCode(() => service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "add_edge", relation: "SUPPORTS",
      from: { id: "foreign", version: 1 }, to: { id: "other", version: 1 }
    }), "BAD_INPUT");
    expectCode(() => service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "add_node", node_kind: "Claim", label: " ", detail: "valid"
    }), "BAD_INPUT");
    expectCode(() => service.list("owner-a", "project-a", 50), "BAD_INPUT");
    expectCode(() => service.restore("owner-a", "project-a", graph.graph_id, 1, 99), "BAD_INPUT");
  });
});
