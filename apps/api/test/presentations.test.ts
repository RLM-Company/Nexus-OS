import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, openDatabase, PresentationStore, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { PresentationPrivacyAdapter } from "../src/presentation-privacy.js";

describe("presentations", () => {
  it("persists owner-only decks, versions edits and refuses stale or fenced writes", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    identity.registerActor("owner-a", "owner-a", "owner");
    identity.registerActor("owner-b", "owner-b", "owner");
    identity.registerActor("owner-a", "agent-a", "agent");
    const issue = (ownerId: string, actorId: string) =>
      identity.issueSession({ ownerId, actorId, assurance: "single_factor", ttlMs: 60_000 }).token;
    const a = `Bearer ${issue("owner-a", "owner-a")}`;
    const b = `Bearer ${issue("owner-b", "owner-b")}`;
    const agent = `Bearer ${issue("owner-a", "agent-a")}`;
    const store = new PresentationStore(db.sqlite);
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      presentationStore: store
    });
    const send = (
      method: "POST" | "PUT" | "DELETE",
      url: string,
      authorization: string,
      payload?: unknown
    ) =>
      Promise.resolve(
        app.inject({
          method,
          url,
          headers: {
            authorization,
            origin: "http://localhost:3000",
            ...(payload === undefined ? {} : { "content-type": "application/json" })
          },
          ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
        })
      );
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/presentations" })).statusCode).toBe(
        401
      );
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/presentations",
            headers: { authorization: agent }
          })
        ).statusCode
      ).toBe(403);
      const created = await send("POST", "/api/v1/presentations", a, { title: "Доклад" });
      expect(created.statusCode).toBe(201);
      const deck = created.json<{
        id: string;
        version: number;
        slides: Array<Record<string, string>>;
      }>();
      expect(deck.version).toBe(1);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/presentations/${deck.id}`,
            headers: { authorization: b }
          })
        ).statusCode
      ).toBe(404);
      expect(
        (await send("DELETE", `/api/v1/presentations/${deck.id}?version=1`, b)).statusCode
      ).toBe(404);
      const edit = {
        version: 1,
        title: "Доклад 2",
        theme: "ocean",
        slides: [
          { ...deck.slides[0], title: "Слайд <скрипт>", notes: "Заметки докладчика" },
          {
            id: "second",
            layout: "two-column",
            title: "Обзор",
            body: "Слева",
            aside: "Справа",
            notes: ""
          }
        ]
      };
      const saved = await send("PUT", `/api/v1/presentations/${deck.id}`, a, edit);
      expect(saved.statusCode).toBe(200);
      expect(saved.json<{ version: number }>().version).toBe(2);
      expect((await send("PUT", `/api/v1/presentations/${deck.id}`, a, edit)).statusCode).toBe(409);
      expect(
        (
          await send("PUT", `/api/v1/presentations/${deck.id}`, a, {
            ...edit,
            version: 2,
            slides: [{ ...edit.slides[0], body: "X".repeat(4001) }]
          })
        ).statusCode
      ).toBe(400);
      const privacy = new PresentationPrivacyAdapter(db.sqlite);
      expect((await privacy.export("owner-a")).records.decks).toHaveLength(1);
      expect((await privacy.export("owner-b")).records.decks).toHaveLength(0);
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('owner-a',1,'quiescing','op','2026-10-12','2026-10-12')"
        )
        .run();
      expect(
        (await send("POST", "/api/v1/presentations", a, { title: "Blocked" })).statusCode
      ).toBe(423);
      db.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owner-a'"
        )
        .run();
      expect((await privacy.delete("owner-a", 1)).deleted_records).toBe(1);
      expect((await privacy.export("owner-a")).records.decks).toHaveLength(0);
    } finally {
      await app.close();
      db.close();
    }
  });
});
