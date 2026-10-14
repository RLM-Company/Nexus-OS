import { loadServerConfig } from "@cosmora/config";
import { IdentityStore, NotificationStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { NotificationPrivacyAdapter } from "../src/notification-privacy.js";

describe("owner notification center", () => {
  it("derives bounded private events and stores read state and quiet preferences", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const identity = new IdentityStore(db.sqlite);
    identity.registerActor("owner-a", "owner-a", "owner");
    identity.registerActor("owner-b", "owner-b", "owner");
    const token = (owner: string) =>
      `Bearer ${identity.issueSession({ ownerId: owner, actorId: owner, assurance: "single_factor", ttlMs: 60_000 }).token}`;
    const a = token("owner-a"),
      b = token("owner-b");
    const at = "2026-10-13T10:00:00.000Z";
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
      )
      .run("project-a", "owner-a", "Private", at, at);
    db.sqlite
      .prepare(
        "INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json) VALUES(?,?,?,?,?,?)"
      )
      .run(
        "work-a",
        "project-a",
        "owner-a",
        "client-a",
        3,
        JSON.stringify({
          id: "work-a",
          status: "completed",
          updated_at: at,
          request: { goal: "Private details" }
        })
      );
    db.sqlite
      .prepare(
        "INSERT INTO research_v1_runs(id,owner_id,project_id,status,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
      )
      .run("research-b", "owner-b", "p-b", "failed", "{}", at, at);
    const store = new NotificationStore(db.sqlite);
    const app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      identityStore: identity,
      identityResolver: new BearerSessionIdentityResolver(identity),
      notificationStore: store
    });
    const get = (authorization: string, url = "/api/v1/notifications") =>
      Promise.resolve(app.inject({ method: "GET", url, headers: { authorization } }));
    const post = (
      authorization: string,
      url: string,
      payload: unknown,
      method: "POST" | "PUT" = "POST"
    ) =>
      Promise.resolve(
        app.inject({
          method,
          url,
          headers: {
            authorization,
            origin: "http://localhost:3000",
            "content-type": "application/json"
          },
          payload: JSON.stringify(payload)
        })
      );
    try {
      expect((await app.inject({ method: "GET", url: "/api/v1/notifications" })).statusCode).toBe(
        401
      );
      const first = (await get(a)).json<{
        items: Array<{ id: string; title: string; read: boolean }>;
        unread: number;
      }>();
      expect(first.items).toHaveLength(1);
      expect(first.unread).toBe(1);
      expect(first.items[0]?.title).not.toContain("Private details");
      expect((await get(b)).json<{ items: unknown[] }>().items).toHaveLength(1);
      expect(
        (await post(b, "/api/v1/notifications/read", { ids: [first.items[0]!.id] })).statusCode
      ).toBe(404);
      expect(
        (await post(a, "/api/v1/notifications/read", { ids: [first.items[0]!.id] })).statusCode
      ).toBe(200);
      expect((await get(a)).json<{ unread: number }>().unread).toBe(0);
      const prefs = {
        in_app_enabled: true,
        browser_enabled: true,
        quiet_from: "22:00",
        quiet_until: "07:30",
        time_zone: "Europe/Moscow"
      };
      expect((await post(a, "/api/v1/notifications/preferences", prefs, "PUT")).statusCode).toBe(
        200
      );
      expect((await get(a, "/api/v1/notifications/preferences")).json()).toEqual(prefs);
      expect(
        (
          await post(
            a,
            "/api/v1/notifications/preferences",
            { ...prefs, time_zone: "Invalid/Zone" },
            "PUT"
          )
        ).statusCode
      ).toBe(400);
      const privacy = new NotificationPrivacyAdapter(db.sqlite);
      expect((await privacy.export("owner-a")).records.reads).toHaveLength(1);
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('owner-a',1,'quiescing','op',?,?)"
        )
        .run(at, at);
      expect(
        (await post(a, "/api/v1/notifications/read", { ids: [first.items[0]!.id] })).statusCode
      ).toBe(423);
      db.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owner-a'"
        )
        .run();
      expect((await privacy.delete("owner-a", 1)).deleted_records).toBe(2);
    } finally {
      await app.close();
      db.close();
    }
  });
});
