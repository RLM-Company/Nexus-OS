import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, OwnerSkillStore, openDatabase, runMigrations } from "@cosmora/db";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

it("a confirmed correction can be edited, exported and deleted via existing owner paths", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const identity = new IdentityStore(db.sqlite);
  identity.registerActor("a", "a", "owner");
  const token = identity.issueSession({
    ownerId: "a",
    actorId: "a",
    assurance: "single_factor",
    ttlMs: 60_000
  }).token;
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    identityStore: identity,
    identityResolver: new BearerSessionIdentityResolver(identity),
    ownerSkillStore: new OwnerSkillStore(db.sqlite)
  });
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) =>
    app.inject({
      method,
      url: `/api/v1/owner-skills${path}`,
      headers: {
        authorization: `Bearer ${token}`,
        origin: "http://localhost:3000",
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) })
    });
  try {
    const draft = {
      format: "kosmora.skill-correction.v1",
      name: "Правка владельца",
      summary: "Явное исправление, подтверждённое владельцем",
      instructions: "Учитывай это исправление владельца как пожелание к ответу: отвечай тезисами"
    };
    const accepted = await call("POST", "/corrections/accept", {
      client_request_id: randomUUID(),
      draft
    });
    expect(accepted.statusCode).toBe(201);
    const id = accepted.json<{ skill: { id: string; current_version: number } }>().skill.id;

    const edited = await call("PUT", `/${id}`, {
      expected_version: 1,
      name: "Уточнённая правка",
      summary: "Отредактировано владельцем",
      instructions: "Отвечай тезисами и без канцелярита"
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ current_version: number }>().current_version).toBe(2);

    const exported = await call("GET", `/${id}/package`);
    expect(exported.statusCode).toBe(200);
    expect(JSON.stringify(exported.json())).toContain("без канцелярита");

    const removed = await call("DELETE", `/${id}`, { expected_version: 2 });
    expect(removed.statusCode).toBe(204);
    const list = await call("GET", "");
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(0);
  } finally {
    await app.close();
    db.close();
  }
});
