import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphWorkspaceService } from "@cosmora/core";
import type {
  IntelligenceGraphRevisionInfo,
  IntelligenceGraphWorkspace,
  IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";
import { registerIntelligenceGraphWorkspaceRoutes } from "../src/intelligence-graph-workspace-routes.js";

class MemoryStore implements IntelligenceGraphWorkspaceRepository {
  snapshots = new Map<string, IntelligenceGraphWorkspace>();
  history = new Map<string, IntelligenceGraphWorkspace[]>();
  create(record: IntelligenceGraphWorkspace) {
    this.snapshots.set(record.graph_id, structuredClone(record));
    this.history.set(record.graph_id, [structuredClone(record)]);
    return record;
  }
  get(owner: string, project: string, graph: string) {
    const found = this.snapshots.get(graph);
    return found?.owner_id === owner && found.project_id === project
      ? structuredClone(found)
      : null;
  }
  list(owner: string, project: string, limit: number) {
    return [...this.snapshots.values()]
      .filter((row) => row.owner_id === owner && row.project_id === project)
      .slice(0, limit)
      .map((row) => structuredClone(row));
  }
  getRevision(owner: string, project: string, graph: string, revision: number) {
    return (
      this.history
        .get(graph)
        ?.find(
          (entry) =>
            entry.owner_id === owner && entry.project_id === project && entry.revision === revision
        ) ?? null
    );
  }
  listRevisions(
    owner: string,
    project: string,
    graph: string,
    limit: number
  ): IntelligenceGraphRevisionInfo[] {
    return (this.history.get(graph) ?? [])
      .filter((row) => row.owner_id === owner && row.project_id === project)
      .slice(-limit)
      .map((row) => ({
        revision: row.revision,
        created_at: row.updated_at,
        summary: "test",
        restored_from_revision: row.restored_from_revision
      }));
  }
  save(record: IntelligenceGraphWorkspace, expectedRevision: number) {
    if (
      this.get(record.owner_id, record.project_id, record.graph_id)?.revision !== expectedRevision
    )
      return null;
    this.snapshots.set(record.graph_id, structuredClone(record));
    this.history.get(record.graph_id)?.push(structuredClone(record));
    return record;
  }
}

const setup = (enabled: boolean, owner = "owner-a") => {
  const app = Fastify();
  const store = new MemoryStore();
  const identity = new StaticIdentityResolver({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: owner });
  registerIntelligenceGraphWorkspaceRoutes(app, {
    enabled,
    service: new IntelligenceGraphWorkspaceService(store),
    projects: {
      getProject: (projectId, ownerId) =>
        ownerId === "owner-a" && projectId === "project-a"
          ? {
              id: "project-a",
              title: "Project",
              status: "ACTIVE" as const,
              created_at: "2026-10-09T00:00:00.000Z",
              updated_at: "2026-10-09T00:00:00.000Z"
            }
          : null
    },
    identity
  });
  return { app, store };
};

describe("graph workspace HTTP integration boundary", () => {
  it("registers no graph endpoints while feature flag is OFF", async () => {
    const { app } = setup(false);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project-a/intelligence-graphs",
      payload: { title: "blocked" }
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("creates/opens/edits/queries a graph only under owner-scoped active project", async () => {
    const { app } = setup(true);
    const base = "/api/v1/projects/project-a/intelligence-graphs";
    const created = await app.inject({ method: "POST", url: base, payload: { title: "Graph" } });
    expect(created.statusCode).toBe(201);
    const g = created.json<IntelligenceGraphWorkspace>();
    expect(g.nodes).toEqual([]);
    const read = await app.inject({ method: "GET", url: `${base}/${g.graph_id}` });
    expect(read.statusCode).toBe(200);
    const added = await app.inject({
      method: "POST",
      url: `${base}/${g.graph_id}/edits`,
      payload: {
        expected_revision: 1,
        operation: {
          kind: "add_node",
          node_kind: "Claim",
          label: "Human",
          detail: "Unverified"
        }
      }
    });
    expect(added.statusCode).toBe(200);
    expect(added.json<IntelligenceGraphWorkspace>().nodes[0]?.verification_status).toBe(
      "discovered"
    );
    const explain = await app.inject({
      method: "GET",
      url: `${base}/${g.graph_id}/explain?q=Human`
    });
    expect(explain.statusCode).toBe(200);
    expect(explain.json<{ readiness: string }>().readiness).toBe("abstain");
    const stale = await app.inject({
      method: "POST",
      url: `${base}/${g.graph_id}/edits`,
      payload: {
        expected_revision: 1,
        operation: {
          kind: "add_node",
          node_kind: "Claim",
          label: "Stale",
          detail: "No overwrite"
        }
      }
    });
    expect(stale.statusCode).toBe(409);
    const invalid = await app.inject({
      method: "POST",
      url: `${base}/${g.graph_id}/edits`,
      payload: {
        expected_revision: 2,
        operation: {
          kind: "add_node",
          node_kind: "Claim",
          label: "x",
          detail: "x",
          owner_id: "owner-b"
        }
      }
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it("returns indistinguishable 404 for foreign owner and project IDs", async () => {
    const { app } = setup(true, "owner-b");
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/projects/project-a/intelligence-graphs",
      payload: { title: "cannot create" }
    });
    expect(result.statusCode).toBe(404);
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/projects/project-b/intelligence-graphs"
    });
    expect(other.statusCode).toBe(404);
    await app.close();
  });
});

describe("graph authoring and transport HTTP", () => {
  it("revises and removes nodes with strict bodies, exports reviewed content and historical revisions", async () => {
    const { app } = setup(true);
    const root = "/api/v1/projects/project-a/intelligence-graphs";
    try {
      let graph = (
        await app.inject({ method: "POST", url: root, payload: { title: "Graph" } })
      ).json<IntelligenceGraphWorkspace>();
      const url = `${root}/${graph.graph_id}`;
      graph = (
        await app.inject({
          method: "POST",
          url: url + "/edits",
          payload: {
            expected_revision: graph.revision,
            operation: {
              kind: "add_node",
              node_kind: "Claim",
              label: "Original",
              detail: "Exact\r\ntext"
            }
          }
        })
      ).json<IntelligenceGraphWorkspace>();
      const node = { id: graph.nodes[0]!.node_id, version: 1 };
      const revised = await app.inject({
        method: "POST",
        url: url + "/edits",
        payload: {
          expected_revision: graph.revision,
          operation: { kind: "revise_node", node, label: "Changed", detail: "Changed" }
        }
      });
      expect(revised.statusCode).toBe(200);
      const historic = await app.inject({ method: "GET", url: url + "/revisions/2" });
      expect(historic.statusCode).toBe(200);
      expect(historic.json<IntelligenceGraphWorkspace>().records[0]?.text).toBe("Original");
      const exported = await app.inject({ method: "GET", url: url + "/package?revision=2" });
      expect(exported.statusCode).toBe(200);
      const packet = exported.json<{ package: unknown; sha256: string }>();
      const preview = await app.inject({
        method: "POST",
        url: root + "/import/preview",
        payload: { package: packet.package }
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json<{ sha256: string }>().sha256).toBe(packet.sha256);
      const imported = await app.inject({
        method: "POST",
        url: root + "/import",
        payload: { package: packet.package, expected_sha256: packet.sha256 }
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json<IntelligenceGraphWorkspace>().graph_id).not.toBe(graph.graph_id);
      expect(imported.json<IntelligenceGraphWorkspace>().nodes[0]?.verification_status).toBe(
        "discovered"
      );
      const invalid = await app.inject({
        method: "POST",
        url: url + "/edits",
        payload: {
          expected_revision: 3,
          operation: {
            kind: "remove_node",
            node: { ...node, version: 2 },
            verification_status: "verified"
          }
        }
      });
      expect(invalid.statusCode).toBe(400);
      const removed = await app.inject({
        method: "POST",
        url: url + "/edits",
        payload: {
          expected_revision: 3,
          operation: { kind: "remove_node", node: { ...node, version: 2 } }
        }
      });
      expect(removed.statusCode).toBe(200);
      const stale = await app.inject({
        method: "POST",
        url: url + "/restore",
        payload: { expected_revision: 3, from_revision: 2 }
      });
      expect(stale.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("fails malformed hashes/packages and fences all transport endpoints while disabled or foreign", async () => {
    const { app, store } = setup(true);
    const root = "/api/v1/projects/project-a/intelligence-graphs";
    const portable = {
      format: "kosmora.intelligence-graph.v1",
      title: "Graph",
      nodes: [],
      edges: []
    };
    try {
      for (const payload of [
        { package: portable, expected_sha256: "0".repeat(64) },
        { package: { ...portable, owner_id: "foreign" }, expected_sha256: "0".repeat(64) }
      ]) {
        expect(
          (await app.inject({ method: "POST", url: root + "/import", payload })).statusCode
        ).toBe(400);
      }
      expect(store.snapshots.size).toBe(0);
    } finally {
      await app.close();
    }
    for (const [enabled, owner] of [
      [false, "owner-a"],
      [true, "owner-b"]
    ] as const) {
      const next = setup(enabled, owner);
      try {
        expect(
          (
            await next.app.inject({
              method: "POST",
              url: root + "/import/preview",
              payload: { package: portable }
            })
          ).statusCode
        ).toBe(404);
        expect(
          (
            await next.app.inject({
              method: "POST",
              url: root + "/import",
              payload: { package: portable, expected_sha256: "0".repeat(64) }
            })
          ).statusCode
        ).toBe(404);
        expect(
          (await next.app.inject({ method: "GET", url: root + "/missing/revisions/1" })).statusCode
        ).toBe(404);
      } finally {
        await next.app.close();
      }
    }
  });
});
