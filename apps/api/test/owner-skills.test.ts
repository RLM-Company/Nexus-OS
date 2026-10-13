import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, OwnerSkillStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { OwnerSkillPrivacyAdapter } from "../src/owner-skill-privacy.js";

describe("owner skills", () => {
  it("versions inert instructions with owner isolation, conflicts and privacy deletion", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    for (const owner of ["owner-a", "owner-b"]) identity.registerActor(owner, owner, "owner");
    const auth = (owner: string) =>
      `Bearer ${identity.issueSession({ ownerId: owner, actorId: owner, assurance: "single_factor", ttlMs: 60_000 }).token}`;
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
      url: string,
      payload?: unknown
    ) =>
      Promise.resolve(
        app.inject({
          method,
          url: `/api/v1/owner-skills${url}`,
          headers: {
            authorization: auth(owner),
            origin: "http://localhost:3000",
            ...(payload === undefined ? {} : { "content-type": "application/json" })
          },
          ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
        })
      );
    const draft = {
      name: "Проверка",
      summary: "Чтение текста",
      instructions: "Шаг 1: проверьте структуру."
    };
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/owner-skills" })).statusCode).toBe(
        401
      );
      const created = await call("owner-a", "POST", "", draft);
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;
      expect((await call("owner-b", "GET", `/${id}`)).statusCode).toBe(404);
      expect(
        (await call("owner-b", "PUT", `/${id}`, { ...draft, expected_version: 1 })).statusCode
      ).toBe(404);
      const updated = await call("owner-a", "PUT", `/${id}`, {
        ...draft,
        instructions: "Шаг 2",
        expected_version: 1
      });
      expect(updated.json<{ current_version: number }>().current_version).toBe(2);
      expect(
        (await call("owner-a", "PUT", `/${id}`, { ...draft, expected_version: 1 })).statusCode
      ).toBe(409);
      const restored = await call("owner-a", "POST", `/${id}/restore`, {
        expected_version: 2,
        source_version: 1
      });
      expect(restored.json<{ current_version: number }>().current_version).toBe(3);
      const detail = (await call("owner-a", "GET", `/${id}`)).json<{
        versions: Array<{ instructions: string }>;
      }>();
      expect(detail.versions).toHaveLength(3);
      expect(detail.versions[0]?.instructions).toBe(draft.instructions);
      expect((await call("owner-b", "DELETE", `/${id}`, { expected_version: 3 })).statusCode).toBe(
        404
      );
      expect((await call("owner-a", "POST", "", { ...draft, instructions: "  " })).statusCode).toBe(
        400
      );
      const disposable = (await call("owner-a", "POST", "", draft)).json<{ id: string }>().id;
      expect(
        (await call("owner-a", "DELETE", `/${disposable}`, { expected_version: 1 })).statusCode
      ).toBe(204);
      expect((await call("owner-a", "GET", `/${disposable}`)).statusCode).toBe(404);
      const privacy = new OwnerSkillPrivacyAdapter(db.sqlite);
      expect((await privacy.export("owner-a")).records.versions).toHaveLength(3);
      const at = "2026-10-13T13:00:00.000Z";
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('owner-a',1,'quiescing','op',?,?)"
        )
        .run(at, at);
      expect((await call("owner-a", "POST", "", draft)).statusCode).toBe(423);
      db.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owner-a'"
        )
        .run();
      expect((await privacy.delete("owner-a", 1)).deleted_records).toBe(4);
      expect((await privacy.export("owner-a")).records.versions).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
    }
  });
});
