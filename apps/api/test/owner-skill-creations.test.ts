import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, OwnerSkillStore, openDatabase, runMigrations } from "@cosmora/db";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { OwnerSkillPrivacyAdapter } from "../src/owner-skill-privacy.js";
import { exportOwnerSkillPackage } from "../src/owner-skill-package.js";
async function fixture() {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const identity = new IdentityStore(db.sqlite);
  for (const owner of ["a", "b"]) identity.registerActor(owner, owner, "owner");
  const tokens = Object.fromEntries(
    ["a", "b"].map((owner) => [
      owner,
      identity.issueSession({
        ownerId: owner,
        actorId: owner,
        assurance: "single_factor",
        ttlMs: 60_000
      }).token
    ])
  );
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    identityStore: identity,
    identityResolver: new BearerSessionIdentityResolver(identity),
    ownerSkillStore: new OwnerSkillStore(db.sqlite)
  });
  const call = (
    owner: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    key?: string
  ) =>
    app.inject({
      method,
      url: `/api/v1/owner-skills${path}`,
      headers: {
        authorization: `Bearer ${tokens[owner]}`,
        origin: "http://localhost:3000",
        ...(key === undefined ? {} : { "idempotency-key": key }),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) })
    });
  return { db, app, call };
}
const draft = { name: "История", summary: "Текст", instructions: "Кириллица 😀\r\n<literal>" };
it("authenticates scopes and receipts, returns the accepted identity on create/import retry and rejects a changed key payload", async () => {
  const { db, app, call } = await fixture();
  try {
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/owner-skills/scope" })).statusCode
    ).toBe(401);
    const scope = (await call("a", "GET", "/scope")).json<{ owner_scope: string }>().owner_scope;
    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect((await call("a", "GET", "/scope")).json()).toEqual({ owner_scope: scope });
    expect((await call("b", "GET", "/scope")).json()).not.toEqual({ owner_scope: scope });
    const key = randomUUID();
    expect((await call("a", "GET", `/creations/${key}`)).statusCode).toBe(404);
    const first = await call("a", "POST", "", draft, key);
    expect(first.statusCode).toBe(201);
    const id = first.json<{ id: string }>().id;
    const retry = await call("a", "POST", "", draft, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const receipt = await call("a", "GET", `/creations/${key}`);
    expect(receipt.json()).toEqual(first.json());
    expect(receipt.headers["cache-control"]).toContain("no-store");
    expect((await call("b", "GET", `/creations/${key}`)).statusCode).toBe(404);
    expect((await call("a", "POST", "", { ...draft, name: "Changed" }, key)).statusCode).toBe(409);
    const pack = exportOwnerSkillPackage(draft);
    expect((await call("a", "POST", "/import", pack, key)).json()).toEqual(first.json());
    expect(
      (await call("a", "POST", "/import", { ...pack, instructions: "tampered" }, key)).statusCode
    ).toBe(400);
    expect(
      (await call("a", "POST", "/import", { ...pack, permissions: ["write"] }, key)).statusCode
    ).toBe(400);
    const importedKey = randomUUID();
    const imported = await call("a", "POST", "/import", pack, importedKey);
    expect(imported.statusCode).toBe(201);
    expect((await call("a", "POST", "/import", pack, importedKey)).json()).toEqual(imported.json());
    expect((await call("a", "POST", "", draft, "wrong")).statusCode).toBe(400);
    expect((await call("a", "POST", "/import", pack, "")).statusCode).toBe(400);
    expect((await call("a", "GET", "/creations/wrong")).statusCode).toBe(400);
    expect((await call("a", "GET", "")).json<{ items: unknown[] }>().items).toHaveLength(2);
    expect(
      (await call("a", "PUT", `/${id}`, { ...draft, name: "Edited", expected_version: 1 }))
        .statusCode
    ).toBe(200);
    expect((await call("a", "POST", "", draft, key)).json()).toMatchObject({
      id,
      name: "Edited",
      current_version: 2
    });
    expect((await call("a", "DELETE", `/${id}`, { expected_version: 2 })).statusCode).toBe(204);
    expect((await call("a", "POST", "", draft, key)).statusCode).toBe(410);
    expect((await call("a", "GET", `/creations/${key}`)).statusCode).toBe(410);
    expect((await call("b", "POST", "", draft, key)).statusCode).toBe(201);
  } finally {
    await app.close();
    db.close();
  }
});
it("exports receipts and tombstones and deletes them only behind the owner privacy fence", async () => {
  const { db, app, call } = await fixture();
  try {
    const key = randomUUID();
    const first = (await call("a", "POST", "", draft, key)).json<{ id: string }>();
    await call("a", "DELETE", `/${first.id}`, { expected_version: 1 });
    const acceptedKey = randomUUID();
    await call("a", "POST", "", draft, acceptedKey);
    const otherKey = randomUUID();
    await call("b", "POST", "", draft, otherKey);
    const privacy = new OwnerSkillPrivacyAdapter(db.sqlite);
    expect((await privacy.export("a")).records.creations).toHaveLength(2);
    expect((await privacy.export("a")).records.creations).toContainEqual(
      expect.objectContaining({ request_id: key, skill_id: null })
    );
    expect(() => privacy.delete("a", 1)).toThrow("DELETION_FENCE_REQUIRED");
    db.sqlite.exec(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'quiescing','op','at','at')"
    );
    expect((await call("a", "POST", "", draft, acceptedKey)).statusCode).toBe(423);
    expect((await call("a", "GET", `/creations/${acceptedKey}`)).statusCode).toBe(423);
    expect((await call("a", "POST", "", draft, randomUUID())).statusCode).toBe(423);
    db.sqlite.exec("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='a'");
    expect((await privacy.delete("a", 1)).deleted_records).toBe(4);
    expect((await privacy.export("a")).records.creations).toEqual([]);
    expect((await privacy.export("a")).records.skills).toEqual([]);
    expect((await privacy.export("b")).records.creations).toHaveLength(1);
    expect((await call("b", "GET", `/creations/${otherKey}`)).statusCode).toBe(200);
  } finally {
    await app.close();
    db.close();
  }
});
