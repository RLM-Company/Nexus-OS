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

  const build = (identity: IdentityContext) => {
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" }),
      database: db,
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
});
