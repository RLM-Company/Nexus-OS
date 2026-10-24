import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphWorkspaceService } from "@cosmora/core";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  SqliteIntelligenceGraphWorkspaceRepository
} from "@cosmora/db";
import type { IntelligenceGraphEvidenceAudit } from "@cosmora/contracts";
import { registerIntelligenceGraphWorkspaceRoutes } from "../src/intelligence-graph-workspace-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";

const setup = async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  projects.createEmptyProject("project-a", "A", "owner-a");
  projects.createEmptyProject("project-b", "B", "owner-a");
  projects.createEmptyProject("project-c", "C", "owner-b");
  db.sqlite.exec("UPDATE projects SET status='ACTIVE'");
  const service = new IntelligenceGraphWorkspaceService(
    new SqliteIntelligenceGraphWorkspaceRepository(db.sqlite)
  );
  const packet = {
    format: "kosmora.intelligence-graph.v1",
    title: "Проверка источников",
    nodes: [
      { key: "s", kind: "Source", label: "Источник", detail: "Точная цитата\r\n<script> $&" },
      { key: "a", kind: "Claim", label: "Утверждение", detail: "Проверяемая позиция" }
    ],
    edges: [
      {
        relation: "SUPPORTS",
        from: "s",
        to: "a",
        evidence: { source: "s", location: "строка 1", excerpt: "Точная цитата" }
      }
    ]
  };
  const graph = service.importPackage(
    "owner-a",
    "project-a",
    packet,
    service.previewImport(packet).sha256
  );
  const makeApp = (owner = "owner-a", enabled = true) => {
    const app = Fastify();
    registerIntelligenceGraphWorkspaceRoutes(app, {
      enabled,
      service,
      projects,
      identity: new StaticIdentityResolver({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: owner })
    });
    return app;
  };
  const app = makeApp();
  const url = `/api/v1/projects/project-a/intelligence-graphs/${graph.graph_id}/evidence-audit`;
  return {
    db,
    projects,
    service,
    graph,
    makeApp,
    app,
    url,
    close: async () => {
      await app.close();
      db.sqlite.close();
    }
  };
};

describe("owner-scoped evidence audit HTTP endpoint", () => {
  it("reads the exact saved revision with a reproducible hash and no graph/material writes", async () => {
    const f = await setup();
    try {
      const before = f.service.get("owner-a", "project-a", f.graph.graph_id);
      const changes = () => f.db.sqlite.prepare("SELECT total_changes() AS n").get()!.n;
      const count = changes();
      const response = await f.app.inject({ method: "GET", url: f.url + "?revision=1" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const { report, sha256 } = response.json<{
        report: IntelligenceGraphEvidenceAudit;
        sha256: string;
      }>();
      expect(report.statistics).toMatchObject({ claims: 1, with_current_citations: 1 });
      expect(report.claims[0]!.supports[0]!.citation!.quote).toBe("Точная цитата");
      expect(createHash("sha256").update(JSON.stringify(report)).digest("hex")).toBe(sha256);
      expect(changes()).toBe(count);
      expect(f.service.get("owner-a", "project-a", f.graph.graph_id)).toEqual(before);
      expect(f.projects.getMaterials("project-a", "owner-a")!.version).toBe(0);
      f.service.edit("owner-a", "project-a", f.graph.graph_id, 1, {
        kind: "rename",
        title: "Изменено"
      });
      expect((await f.app.inject({ method: "GET", url: f.url + "?revision=1" })).json()).toEqual({
        report,
        sha256
      });
      expect(
        (await f.app.inject({ method: "GET", url: f.url + "?revision=2" })).json<{
          report: IntelligenceGraphEvidenceAudit;
        }>().report.graph.title
      ).toBe("Изменено");
    } finally {
      await f.close();
    }
  });
  it("rejects missing/invalid revisions and authority fields without writes", async () => {
    const f = await setup();
    try {
      for (const query of [
        "",
        "?revision=0",
        "?revision=-1",
        "?revision=1.5",
        "?revision=no",
        "?revision=1&owner_id=owner-b",
        "?revision=1&verified=true",
        "?revision=2"
      ])
        expect((await f.app.inject({ method: "GET", url: f.url + query })).statusCode, query).toBe(
          400
        );
      expect(f.service.revisions("owner-a", "project-a", f.graph.graph_id)).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
  it("does not reveal graphs across projects, owners or inactive projects", async () => {
    const f = await setup();
    const other = f.makeApp("owner-b");
    try {
      expect((await other.inject({ method: "GET", url: f.url + "?revision=1" })).statusCode).toBe(
        404
      );
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: f.url.replace("project-a", "project-b") + "?revision=1"
          })
        ).statusCode
      ).toBe(404);
      expect(
        (
          await f.app.inject({
            method: "GET",
            url: f.url.replace("project-a", "project-c") + "?revision=1"
          })
        ).statusCode
      ).toBe(404);
      f.db.sqlite.exec("UPDATE projects SET status='ARCHIVED' WHERE id='project-a'");
      expect((await f.app.inject({ method: "GET", url: f.url + "?revision=1" })).statusCode).toBe(
        404
      );
    } finally {
      await other.close();
      await f.close();
    }
  });
  it("keeps the route unavailable when graph functionality is off", async () => {
    const f = await setup();
    const disabled = f.makeApp("owner-a", false);
    try {
      expect(
        (await disabled.inject({ method: "GET", url: f.url + "?revision=1" })).statusCode
      ).toBe(404);
    } finally {
      await disabled.close();
      await f.close();
    }
  });
});
