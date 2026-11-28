import type { IdentityContext } from "@cosmora/contracts";
import { openDatabase, runMigrations, StarsOrgStore } from "@cosmora/db";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerStarsMissionRoutes } from "../src/stars-mission-routes.js";

const apps: FastifyInstance[] = [];
const dbs: Array<ReturnType<typeof openDatabase>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const identity: IdentityContext = {
  owner_id: "a",
  actor_id: "a",
  actor_kind: "owner",
  assurance: "local",
  session_id: "test",
  authenticated_at: "2026-11-27T00:00:00.000Z"
} as IdentityContext;
const setup = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const app = Fastify();
  apps.push(app);
  registerStarsMissionRoutes({
    app,
    store: {
      get: () => null,
      list: () => [],
      save: (value: unknown) => value
    } as never,
    orgStore: new StarsOrgStore(db.sqlite),
    identityFor: () => identity
  });
  return { app };
};
const node = (
  id: string,
  role: string,
  manager_id: string | null,
  zones: string[],
  projects: string[]
) => ({
  id,
  role,
  manager_id,
  responsibility_zones: zones,
  project_ids: projects,
  status: "active",
  effective_from: "2026-11-27T10:00:00.000Z"
});
const send = (app: FastifyInstance, url: string, body?: unknown) =>
  app.inject({
    method: body === undefined ? "GET" : "POST",
    url,
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    headers: body === undefined ? {} : { "content-type": "application/json" }
  });

describe("Stars org HTTP lifecycle", () => {
  it("creates a hierarchy, serves it and rejects a stale change", async () => {
    const { app } = await setup();
    const base = "/api/v1/stars/org/team-1";
    const created = await send(app, base, {
      nodes: [
        node("chief", "chief", null, ["*"], ["p1"]),
        node("sub", "submanager", "chief", ["delivery"], ["p1"]),
        node("worker", "executor", "sub", ["delivery"], [])
      ]
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ version: number }>().version).toBe(1);
    expect((await send(app, base)).json<{ version: number }>().version).toBe(1);

    const stale = await send(app, `${base}/change`, {
      expected_version: 0,
      changes: [{ op: "add", node: node("worker2", "executor", "sub", ["delivery"], []) }]
    });
    expect(stale.statusCode).toBe(409);
    const changed = await send(app, `${base}/change`, {
      expected_version: 1,
      changes: [{ op: "add", node: node("worker2", "executor", "sub", ["delivery"], []) }]
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ version: number }>().version).toBe(2);

    const duplicate = await send(app, "/api/v1/stars/org/team-2", {
      nodes: [
        node("a", "chief", null, ["*"], ["p"]),
        node("b", "submanager", "a", ["x"], ["p"]),
        node("c", "submanager", "a", ["y"], ["p"])
      ]
    });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe("DOUBLE_OWNER");
  });
});
