import Fastify from "fastify";
import { expect, it } from "vitest";
import { IntelligenceGraphWorkspaceService } from "@cosmora/core";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  SqliteIntelligenceGraphWorkspaceRepository
} from "@cosmora/db";
import { OwnerPrivacyCoordinator } from "../src/account-settings/privacy/coordinator.js";
import { AccountCorePrivacyAdapter } from "../src/account-settings/privacy/account-core-adapter.js";
import { intelligenceGraphPrivacyAdapter } from "../src/intelligence-graph-privacy.js";
import { registerIntelligenceGraphWorkspaceRoutes } from "../src/intelligence-graph-workspace-routes.js";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";

it("uses managed migrations with gated routes, owner isolation and the real privacy coordinator", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  projects.createEmptyProject("managed-a", "Owner A", "owner-a");
  projects.createEmptyProject("managed-b", "Owner B", "owner-b");
  db.sqlite.exec("UPDATE projects SET status='ACTIVE'");
  const repository = new SqliteIntelligenceGraphWorkspaceRepository(db.sqlite);
  const service = new IntelligenceGraphWorkspaceService(repository);
  const privacy = new OwnerPrivacyCoordinator(db.sqlite, {
    required: ["account-core", "intelligence-graphs"]
  });
  privacy.register(new AccountCorePrivacyAdapter(db.sqlite, () => Promise.resolve()));
  privacy.register(intelligenceGraphPrivacyAdapter(repository));
  const dependencies = {
    service,
    projects,
    identity: new StaticIdentityResolver({ ...LOCAL_DEVELOPMENT_IDENTITY, owner_id: "owner-a" })
  };
  const disabled = Fastify();
  const enabled = Fastify();
  try {
    registerIntelligenceGraphWorkspaceRoutes(disabled, { ...dependencies, enabled: false });
    expect(
      (await disabled.inject("/api/v1/projects/managed-a/intelligence-graphs")).statusCode
    ).toBe(404);
    registerIntelligenceGraphWorkspaceRoutes(enabled, { ...dependencies, enabled: true });
    const created = await enabled.inject({
      method: "POST",
      url: "/api/v1/projects/managed-a/intelligence-graphs",
      payload: { title: "Durable graph" }
    });
    expect(created.statusCode).toBe(201);
    const own = created.json<{ graph_id: string }>();
    const foreign = service.create("owner-b", "managed-b", "Foreign private graph");
    expect(
      (await enabled.inject(`/api/v1/projects/managed-b/intelligence-graphs/${foreign.graph_id}`))
        .statusCode
    ).toBe(404);
    const manifest = await privacy.export("owner-a");
    expect(manifest.complete).toBe(true);
    expect(
      manifest.sections["intelligence-graphs"]?.records.intelligence_graph_workspaces
    ).toHaveLength(1);
    expect(JSON.stringify(manifest)).toContain(own.graph_id);
    expect(JSON.stringify(manifest)).not.toContain(foreign.graph_id);
    expect(privacy.overview("owner-a").lifecycle).toBe("active");
    expect(service.create("owner-a", "managed-a", "After export").revision).toBe(1);
    expect(db.sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok"
    });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    await enabled.close();
    await disabled.close();
    db.close();
  }
});
