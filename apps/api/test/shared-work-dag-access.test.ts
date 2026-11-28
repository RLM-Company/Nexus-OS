import type { IdentityContext } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  ManagerWorkStore,
  PolicyStore,
  ProjectMembershipStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { ModelGateway, ModelRegistry, ModelRouter } from "@cosmora/model-gateway";
import { AccountStore } from "../src/account-settings/account-store.js";

const identity = (ownerId: string): IdentityContext =>
  ({
    owner_id: ownerId,
    actor_id: ownerId,
    actor_kind: "owner",
    session_id: ownerId + "-session",
    assurance: "local",
    authenticated_at: "2026-11-27T00:00:00.000Z"
  }) as IdentityContext;
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const dbs: Array<ReturnType<typeof openDatabase>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

describe("shared Work DAG access", () => {
  it("lists and opens a shared DAG for an accepted member; stale id dies on revoke", async () => {
    const db = openDatabase(":memory:");
    dbs.push(db);
    await runMigrations(db);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const accountStore = new AccountStore(db.sqlite);
    accountStore.migrate();
    const projects = new ProjectStore(db.sqlite);
    const project = projects.createProject("Shared DAG", "shared-dag", "owner-a").project.id;
    const policy = new PolicyStore(db.sqlite);
    policy.ensureProfile(project);
    const runtime = await buildModelRuntime(config);
    const gateway = new ModelGateway(
      [{ id: "mock", modelId: "manager-b0.1", async *stream() {} }] as never,
      new ModelRouter(
        new ModelRegistry(loadModelRegistryDocument("config/model-registry.v1.json"))
      ),
      [],
      {
        maxAttemptsPerRoute: 1,
        now: () => Date.now(),
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 1,
        circuitFailureThreshold: 10,
        circuitOpenMs: 1000
      }
    );
    const works = new ManagerWorkStore(db.sqlite, { maxConcurrentWork: 1 });
    const coordinator = new ManagerWorkCoordinator({
      store: works,
      projects,
      policy,
      emergency: new EmergencyStopStore(db.sqlite),
      gateway,
      manager: runtime.manager,
      ownerBudget: accountStore,
      maxConcurrentWork: 1
    });
    const dag = coordinator.dag.create(project, "owner-a", "owner-a", {
      client_request_id: "shared-dag-1",
      title: "Shared",
      nodes: [{ id: "n", title: "N", goal: "create n.txt", depends_on: [] }]
    });
    const membership = new ProjectMembershipStore(db.sqlite);
    const build = (ownerId: string) => {
      const app = buildApp({
        config,
        database: db,
        projectStore: projects,
        projectMembershipStore: membership,
        managerWorkStore: works,
        managerWorkCoordinator: coordinator,
        modelGateway: runtime.gateway,
        chat: runtime.chat,
        identityResolver: new StaticIdentityResolver(identity(ownerId))
      });
      apps.push(app);
      return app;
    };
    const memberApp = build("owner-b");
    const base = `/api/v1/projects/${project}/work-dags`;
    expect((await memberApp.inject({ method: "GET", url: base })).statusCode).toBe(404);
    membership.invite(project, "owner-a", { account_id: "owner-b", role: "editor" });
    expect((await memberApp.inject({ method: "GET", url: base })).statusCode).toBe(404);
    membership.accept(project, "owner-b");
    expect(
      (await memberApp.inject({ method: "GET", url: base }))
        .json<{ items: Array<{ id: string }> }>()
        .items.map((i) => i.id)
    ).toContain(dag.id);
    expect((await memberApp.inject({ method: "GET", url: `${base}/${dag.id}` })).statusCode).toBe(
      200
    );
    const created = await memberApp.inject({
      method: "POST",
      url: base,
      payload: {
        client_request_id: "shared-editor-create",
        title: "Editor plan",
        nodes: [{ id: "n", title: "N", goal: "write n.txt", depends_on: [] }]
      }
    });
    expect(created.statusCode).toBe(201);
    expect(works.dag.list(project, "owner-a").some((item) => item.title === "Editor plan")).toBe(
      true
    );
    membership.invite(project, "owner-a", { account_id: "owner-viewer", role: "viewer" });
    membership.accept(project, "owner-viewer");
    const viewerApp = build("owner-viewer");
    expect((await viewerApp.inject({ method: "GET", url: `${base}/${dag.id}` })).statusCode).toBe(
      200
    );
    expect(
      (
        await viewerApp.inject({
          method: "PUT",
          url: `${base}/${dag.id}/title`,
          payload: { title: "Viewer changed", expected_version: 1 }
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await viewerApp.inject({
          method: "POST",
          url: base,
          payload: {
            client_request_id: "viewer-create",
            title: "Viewer plan",
            nodes: [{ id: "n", title: "N", goal: "write n.txt", depends_on: [] }]
          }
        })
      ).statusCode
    ).toBe(404);
    expect(works.dag.get(dag.id, "owner-a")?.title).toBe("Shared");
    membership.revoke(project, "owner-a", "owner-b");
    expect((await memberApp.inject({ method: "GET", url: `${base}/${dag.id}` })).statusCode).toBe(
      404
    );
    expect((await memberApp.inject({ method: "GET", url: base })).statusCode).toBe(404);
  });
});
