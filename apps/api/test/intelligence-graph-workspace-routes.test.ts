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
    const g = created.json() as IntelligenceGraphWorkspace;
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
    expect((added.json() as IntelligenceGraphWorkspace).nodes[0]?.verification_status).toBe(
      "discovered"
    );
    const explain = await app.inject({
      method: "GET",
      url: `${base}/${g.graph_id}/explain?q=Human`
    });
    expect(explain.statusCode).toBe(200);
    expect(explain.json().readiness).toBe("abstain");
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
