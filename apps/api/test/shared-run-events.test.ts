/* eslint-disable @typescript-eslint/require-await -- Deterministic local fixtures. */
import { randomUUID } from "node:crypto";
import type { IdentityContext } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import {
  GeneralChatStore,
  ProjectMembershipStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { StaticIdentityResolver } from "../src/identity.js";
import { buildModelRuntime } from "../src/model-runtime.js";

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

describe("shared project run event stream", () => {
  it("lets an accepted member read a shared run's events by id, but not a revoked or third account", async () => {
    const db = openDatabase(":memory:");
    dbs.push(db);
    await runMigrations(db);
    const project = new ProjectStore(db.sqlite).createProject("Shared", "shared-events", "owner-a")
      .project.id;
    const membership = new ProjectMembershipStore(db.sqlite);
    const chats = new GeneralChatStore(db.sqlite);
    const created = chats.createChat(
      "Общая задача",
      randomUUID(),
      "owner-a",
      [],
      "kosmora",
      undefined,
      project
    );
    chats.cancelRun(created.run.id, "owner-a");

    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    const build = (ownerId: string) => {
      const app = buildApp({
        config,
        database: db,
        generalChatStore: chats,
        modelGateway: runtime.gateway,
        chat: runtime.chat,
        projectMembershipStore: membership,
        identityResolver: new StaticIdentityResolver(identity(ownerId))
      });
      apps.push(app);
      return app;
    };
    const ownerApp = build("owner-a");
    const memberApp = build("owner-b");
    const thirdApp = build("owner-c");
    const url = `/api/v1/chat-runs/${created.run.id}/events`;
    expect((await ownerApp.inject({ method: "GET", url })).body).toContain("event: run.cancelled");
    expect((await memberApp.inject({ method: "GET", url })).statusCode).toBe(404); // not invited

    membership.invite(project, "owner-a", { account_id: "owner-b", role: "viewer" });
    expect((await memberApp.inject({ method: "GET", url })).statusCode).toBe(404); // not accepted
    membership.accept(project, "owner-b");
    expect((await memberApp.inject({ method: "GET", url })).body).toContain("event: run.cancelled");
    expect((await thirdApp.inject({ method: "GET", url })).statusCode).toBe(404);

    // Previously obtained run id cannot be reused after revoke.
    membership.revoke(project, "owner-a", "owner-b");
    expect((await memberApp.inject({ method: "GET", url })).statusCode).toBe(404);
  });
});
