import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  ProjectMembershipStore,
  ProjectSourceStore
} from "@cosmora/db";
import type { IdentityContext } from "@cosmora/contracts";
import { StaticIdentityResolver } from "../src/identity.js";
import { buildApp } from "../src/app.js";
import { loadServerConfig } from "@cosmora/config";
import { buildModelRuntime } from "../src/model-runtime.js";
import { GeneralChatStore } from "@cosmora/db";

const account = (id: string): IdentityContext => ({
  owner_id: id,
  actor_id: id,
  actor_kind: "owner",
  session_id: id + "-session",
  assurance: "local",
  authenticated_at: "2026-11-26T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z"
});

describe("project membership API", () => {
  let db: ReturnType<typeof openDatabase>;
  let projectId: string;
  let membership: ProjectMembershipStore;
  let ownerApp: Awaited<ReturnType<typeof buildApp>>;
  let memberApp: Awaited<ReturnType<typeof buildApp>>;
  let thirdApp: Awaited<ReturnType<typeof buildApp>>;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  let runtime: Awaited<ReturnType<typeof buildModelRuntime>>;

  const build = (identity: IdentityContext) => {
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" }),
      database: db,
      modelGateway: runtime.gateway,
      manager: runtime.manager,
      chat: runtime.chat,
      generalChatStore: new GeneralChatStore(db.sqlite),
      projectStore: new ProjectStore(db.sqlite),
      projectMembershipStore: membership,
      projectSourceStore: new ProjectSourceStore(db.sqlite),
      identityResolver: new StaticIdentityResolver(identity)
    });
    apps.push(app);
    return app;
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    runtime = await buildModelRuntime(loadServerConfig({ NODE_ENV: "test" }));
    projectId = new ProjectStore(db.sqlite).createProject("Shared", "shared", "owner-a").project.id;
    membership = new ProjectMembershipStore(db.sqlite);
    ownerApp = build(account("owner-a"));
    memberApp = build(account("owner-b"));
    thirdApp = build(account("owner-c"));
  });
  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.length = 0;
    db.close();
  });

  it("invites, accepts, denies a third account and revokes access", async () => {
    const base = `/api/v1/projects/${projectId}/members`;
    const denied = await thirdApp.inject({ method: "GET", url: base });
    expect(denied.statusCode).toBe(404);
    const sourcesDenied = await thirdApp.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/sources/exclusions`
    });
    expect(sourcesDenied.statusCode).toBe(403);
    expect(sourcesDenied.json()).toEqual({ error: { code: "PROJECT_MEMBER_REQUIRED" } });

    const invited = await ownerApp.inject({
      method: "POST",
      url: `${base}/invite`,
      payload: { account_id: "owner-b", role: "editor" }
    });
    expect(invited.statusCode).toBe(200);
    const invitedBody = invited.json<{ members: Array<{ account_id: string; status: string }> }>();
    expect(invitedBody.members.find((m) => m.account_id === "owner-b")?.status).toBe("invited");

    const accepted = await memberApp.inject({ method: "POST", url: `${base}/accept` });
    expect(accepted.statusCode).toBe(200);
    const acceptedBody = accepted.json<{
      members: Array<{ account_id: string; status: string }>;
    }>();
    expect(acceptedBody.members.find((m) => m.account_id === "owner-b")?.status).toBe("active");
    expect(membership.canAccess(projectId, "owner-b")).toBe(true);
    expect(membership.canAccess(projectId, "owner-c")).toBe(false);

    const revoked = await ownerApp.inject({
      method: "DELETE",
      url: `${base}/owner-b`
    });
    expect(revoked.statusCode).toBe(200);
    expect(membership.canAccess(projectId, "owner-b")).toBe(false);
    expect(membership.canAccess(projectId, "owner-a")).toBe(true);
  });

  it("scopes materials, downloads, history and source receipts to the accepted project", async () => {
    const base = `/api/v1/projects/${projectId}`;
    const materials = {
      version: 0,
      instructions: "Общее поручение",
      attachments: [{ name: "offer.txt", content: "Смета 00123" }]
    };
    expect(
      (await ownerApp.inject({ method: "PUT", url: base + "/materials", payload: materials }))
        .statusCode
    ).toBe(200);
    const personal = new GeneralChatStore(db.sqlite).createChat(
      "Личная память",
      "private",
      "owner-a"
    );
    const sourceStore = new ProjectSourceStore(db.sqlite);
    const source = {
      reference: "fixture:ref",
      kind: "history" as const,
      version: 1,
      sha256: "a".repeat(64),
      quote: "Личная память",
      excerpt_only: true,
      source_kind: "chat_message" as const,
      source_id: personal.userMessage.id
    };
    const history = await ownerApp.inject(base);
    const ownMessage = history.json<{ messages: { id: string }[] }>().messages[0]!;
    sourceStore.recordRunSources(projectId, "owner-a", {
      run_id: "run-shared",
      sources: [
        source,
        {
          ...source,
          reference: "project:ref",
          source_kind: "project_message",
          source_id: ownMessage.id,
          quote: "Shared"
        }
      ]
    });
    expect((await memberApp.inject(base + "/materials")).statusCode).toBe(404);
    expect(
      (
        await ownerApp.inject({
          method: "POST",
          url: base + "/members/invite",
          payload: { account_id: "owner-b", role: "editor" }
        })
      ).statusCode
    ).toBe(200);
    expect((await memberApp.inject(base + "/materials")).statusCode).toBe(404);
    expect(
      (await memberApp.inject({ method: "POST", url: base + "/members/accept" })).statusCode
    ).toBe(200);
    expect((await memberApp.inject(base + "/materials")).json()).toMatchObject({
      attachments: materials.attachments
    });
    expect((await memberApp.inject(base + "/materials/files/0")).body).toBe("Смета 00123");
    expect((await memberApp.inject(base + "?q=Shared")).json()).toMatchObject({
      messages: [{ content: "Shared" }]
    });
    expect((await memberApp.inject(base + "/sources/exclusions")).statusCode).toBe(200);
    expect((await memberApp.inject(base + "/sources/run/run-shared")).json()).toMatchObject({
      sources: [{ source_id: ownMessage.id }]
    });
    expect((await memberApp.inject("/api/v1/chats/" + personal.chat.id)).statusCode).toBe(404);
    expect((await thirdApp.inject(base + "/materials/files/0")).statusCode).toBe(404);
    const viewer = build(account("owner-viewer"));
    expect(
      (
        await ownerApp.inject({
          method: "POST",
          url: base + "/members/invite",
          payload: { account_id: "owner-viewer", role: "viewer" }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (await viewer.inject({ method: "POST", url: base + "/members/accept" })).statusCode
    ).toBe(200);
    expect((await viewer.inject(base + "/materials")).statusCode).toBe(200);
    expect(
      (
        await viewer.inject({
          method: "PUT",
          url: base + "/materials",
          payload: { ...materials, version: 1 }
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await memberApp.inject({
          method: "PUT",
          url: base + "/materials",
          payload: { ...materials, version: 1, instructions: "Правка редактора" }
        })
      ).statusCode
    ).toBe(200);
    expect((await ownerApp.inject(base + "/materials")).json()).toMatchObject({
      version: 2,
      instructions: "Правка редактора"
    });
    expect(
      (await ownerApp.inject({ method: "DELETE", url: base + "/members/owner-b" })).statusCode
    ).toBe(200);
    for (const path of ["", "/materials", "/materials/files/0"])
      expect((await memberApp.inject(base + path)).statusCode).toBe(404);
    expect((await memberApp.inject(base + "/sources/run/run-shared")).statusCode).toBe(403);
    expect(
      (
        await memberApp.inject({
          method: "PUT",
          url: base + "/materials",
          payload: { ...materials, version: 2 }
        })
      ).statusCode
    ).toBe(404);
  });
});
