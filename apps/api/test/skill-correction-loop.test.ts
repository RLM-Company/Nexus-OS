import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, OwnerSkillStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";

const fixture = async () => {
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
  const call = (method: "GET" | "POST", path: string, body?: unknown) =>
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
  return { db, app, call };
};

describe("owner correction confirmation loop", () => {
  const apps: Awaited<ReturnType<typeof fixture>>["app"][] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  it("propose is inert: returns a draft and creates nothing", async () => {
    const f = await fixture();
    apps.push(f.app);
    const proposed = await f.call("POST", "/corrections/propose", {
      correction: "Не используй канцелярит"
    });
    expect(proposed.statusCode).toBe(200);
    const draft = proposed.json<{ draft: { accepted: boolean; format: string } }>().draft;
    expect(draft.accepted).toBe(false);
    expect(draft.format).toBe("kosmora.skill-correction.v1");
    const list = await f.call("GET", "");
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(0);
    f.db.close();
  });

  it("only an explicit accept persists the rule, and it is idempotent", async () => {
    const f = await fixture();
    apps.push(f.app);
    const proposed = await f.call("POST", "/corrections/propose", {
      correction: "Отвечай тезисами"
    });
    const draft = proposed.json<{
      draft: { name: string; summary: string; instructions: string; format: string };
    }>().draft;
    const requestId = randomUUID();
    const body = {
      client_request_id: requestId,
      draft: {
        format: draft.format,
        name: draft.name,
        summary: draft.summary,
        instructions: draft.instructions
      }
    };
    const accepted = await f.call("POST", "/corrections/accept", body);
    expect(accepted.statusCode).toBe(201);
    const skill = accepted.json<{ skill: { id: string; name: string } }>().skill;
    expect(skill.name).toBe("Правка владельца");
    const list = await f.call("GET", "");
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
    const replay = await f.call("POST", "/corrections/accept", body);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<{ skill: { id: string } }>().skill.id).toBe(skill.id);
    const list2 = await f.call("GET", "");
    expect(list2.json<{ items: unknown[] }>().items).toHaveLength(1);
    f.db.close();
  });

  it("rejects a tampered draft and a changed request id payload", async () => {
    const f = await fixture();
    apps.push(f.app);
    const base = {
      client_request_id: randomUUID(),
      draft: {
        format: "kosmora.skill-correction.v1",
        name: "Правка владельца",
        summary: "Явное исправление, подтверждённое владельцем",
        instructions: "Учитывай это исправление: отвечай тезисами"
      }
    };
    expect((await f.call("POST", "/corrections/accept", base)).statusCode).toBe(201);
    const tampered = await f.call("POST", "/corrections/accept", {
      client_request_id: base.client_request_id,
      draft: { ...base.draft, instructions: "другое правило" }
    });
    expect(tampered.statusCode).toBe(409);
    const malformed = await f.call("POST", "/corrections/propose", { correction: "  " });
    expect(malformed.statusCode).toBe(400);
    f.db.close();
  });
});
