import { loadServerConfig } from "@cosmora/config";
import {
  IdentityStore,
  openDatabase,
  PresentationStore,
  runMigrations,
  type Presentation
} from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { PresentationPrivacyAdapter } from "../src/presentation-privacy.js";

async function fixture() {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  const identity = new IdentityStore(db.sqlite);
  const tokens: Record<string, string> = {};
  for (const owner of ["owner-a", "owner-b"]) {
    identity.registerActor(owner, owner, "owner");
    tokens[owner] =
      `Bearer ${identity.issueSession({ ownerId: owner, actorId: owner, assurance: "single_factor", ttlMs: 60000 }).token}`;
  }
  const store = new PresentationStore(db.sqlite);
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    identityStore: identity,
    identityResolver: new BearerSessionIdentityResolver(identity),
    presentationStore: store
  });
  const request = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    payload?: unknown,
    owner = "owner-a"
  ) =>
    app.inject({
      method,
      url: `/api/v1/presentations${path}`,
      headers: {
        authorization: tokens[owner]!,
        origin: "http://localhost:3000",
        "content-type": "application/json"
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) })
    });
  return {
    db,
    store,
    request,
    close: async () => {
      await app.close();
      db.close();
    }
  };
}

describe("presentation import and durable history", () => {
  it("isolates previews and restores a snapshot as a new version without overwriting a stale editor", async () => {
    const f = await fixture();
    try {
      const first = (await f.request("POST", "", { title: "Исходник" })).json<Presentation>();
      const second = (
        await f.request("PUT", `/${first.id}`, {
          ...first,
          version: 1,
          title: "Правка",
          slides: [{ ...first.slides[0], notes: "Не потерять заметки" }]
        })
      ).json<Presentation>();
      expect(second.version).toBe(2);
      const history = await f.request("GET", `/${first.id}/versions`);
      expect(history.json<{ items: { version: number }[] }>().items.map((v) => v.version)).toEqual([
        2, 1
      ]);
      for (const path of [`/${first.id}/versions`, `/${first.id}/versions/1`])
        expect((await f.request("GET", path, undefined, "owner-b")).statusCode).toBe(404);
      expect(
        (
          await f.request(
            "POST",
            `/${first.id}/restore`,
            { expected_version: 2, source_version: 1 },
            "owner-b"
          )
        ).statusCode
      ).toBe(404);
      expect(
        (
          await f.request("POST", `/${first.id}/restore`, {
            expected_version: 1,
            source_version: 1
          })
        ).statusCode
      ).toBe(409);
      expect(
        (
          await f.request("POST", `/${first.id}/restore`, {
            expected_version: 2,
            source_version: 99
          })
        ).statusCode
      ).toBe(404);
      const restored = await f.request("POST", `/${first.id}/restore`, {
        expected_version: 2,
        source_version: 1
      });
      expect(restored.json<Presentation>()).toMatchObject({
        title: "Исходник",
        version: 3,
        slides: first.slides
      });
      expect(f.store.revision("owner-a", first.id, 3)).toMatchObject({
        source: "restore",
        source_version: 1
      });
      expect(f.store.revision("owner-a", first.id, 2).slides[0]?.notes).toBe("Не потерять заметки");
      expect((await f.request("PUT", `/${first.id}`, { ...second, version: 2 })).statusCode).toBe(
        409
      );
      expect(() =>
        f.db.sqlite
          .prepare("UPDATE presentation_versions SET title='altered' WHERE presentation_id=?")
          .run(first.id)
      ).toThrow("PRESENTATION_VERSION_IMMUTABLE");
      const privacy = new PresentationPrivacyAdapter(f.db.sqlite);
      expect((await privacy.export("owner-a")).records.versions).toHaveLength(3);
      expect((await privacy.export("owner-b")).records.versions).toHaveLength(0);
      f.db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('owner-a',1,'quiescing','op','now','now')"
        )
        .run();
      expect(
        (
          await f.request("POST", `/${first.id}/restore`, {
            expected_version: 3,
            source_version: 2
          })
        ).statusCode
      ).toBe(423);
      expect(
        (await f.request("POST", "/import", { format: "kosmora-presentation-v1", ...first }))
          .statusCode
      ).toBe(423);
      expect(f.store.get("owner-a", first.id).version).toBe(3);
      f.db.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owner-a'"
        )
        .run();
      expect((await privacy.delete("owner-a", 1)).deleted_records).toBe(4);
      expect((await privacy.export("owner-a")).records.versions).toHaveLength(0);
      expect(f.db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      await f.close();
    }
  });

  it("imports only a bounded copy with new slide IDs and leaves no partial deck after invalid input or quota refusal", async () => {
    const f = await fixture();
    try {
      const original = f.store.create("owner-b", "Другая презентация");
      const content = {
        format: "kosmora-presentation-v1",
        title: original.title,
        theme: original.theme,
        slides: [{ ...original.slides[0], notes: "Заметки & <текст>" }]
      };
      const response = await f.request("POST", "/import", {
        ...content,
        id: original.id,
        owner_id: "owner-b",
        version: 999
      });
      expect(response.statusCode).toBe(201);
      const imported = response.json<Presentation>();
      expect(imported.id).not.toBe(original.id);
      expect(imported.slides[0]?.id).not.toBe(original.slides[0]?.id);
      expect(imported.slides[0]?.notes).toBe(content.slides[0]?.notes);
      expect(imported.version).toBe(1);
      expect(f.store.versions("owner-a", imported.id)[0]?.source).toBe("import");
      expect(f.store.list("owner-b")).toHaveLength(1);
      for (const bad of [
        { ...content, format: "remote-url", url: "https://evil.example" },
        { ...content, slides: [content.slides[0], content.slides[0]] },
        {
          ...content,
          slides: Array.from({ length: 51 }, (_, i) => ({ ...content.slides[0], id: `s${i}` }))
        },
        { ...content, slides: [{ ...content.slides[0], body: "X".repeat(4001) }] },
        { ...content, title: "\u0000bad" }
      ])
        expect((await f.request("POST", "/import", bad)).statusCode).toBe(400);
      expect(f.store.list("owner-a")).toHaveLength(1);
      for (let i = 1; i < 40; i++) f.store.create("owner-a", `Deck ${i}`);
      const before = f.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM presentation_versions WHERE owner_id='owner-a'")
        .get()!.n;
      expect((await f.request("POST", "/import", content)).statusCode).toBe(413);
      expect(
        f.db.sqlite
          .prepare("SELECT COUNT(*) AS n FROM presentation_versions WHERE owner_id='owner-a'")
          .get()!.n
      ).toBe(before);
    } finally {
      await f.close();
    }
  });

  it("keeps the latest 20 checkpoints and deletes them with their presentation", async () => {
    const f = await fixture();
    try {
      let deck = f.store.create("owner-a", "History");
      f.db.sqlite.exec(
        "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON presentation_versions WHEN NEW.source='save' BEGIN SELECT RAISE(ABORT,'CHECKPOINT_FAILED'); END;"
      );
      expect(() =>
        f.store.save("owner-a", deck.id, 1, { ...deck, title: "Must roll back" })
      ).toThrow("CHECKPOINT_FAILED");
      expect(f.store.get("owner-a", deck.id).title).toBe("History");
      expect(f.store.versions("owner-a", deck.id)).toHaveLength(1);
      f.db.sqlite.exec("DROP TRIGGER fail_checkpoint");
      for (let i = 0; i < 25; i++)
        deck = f.store.save("owner-a", deck.id, deck.version, { ...deck, title: `Version ${i}` });
      const history = f.store.versions("owner-a", deck.id);
      expect(history).toHaveLength(20);
      expect(history[0]?.version).toBe(26);
      expect(history.at(-1)?.version).toBe(7);
      expect(() => f.store.restore("owner-a", deck.id, 26, 1)).toThrow("NOT_FOUND");
      deck = f.store.restore("owner-a", deck.id, 26, 7);
      expect(deck.version).toBe(27);
      expect(deck.title).toBe("Version 5");
      f.store.delete("owner-a", deck.id, 27);
      expect(
        f.db.sqlite
          .prepare("SELECT * FROM presentation_versions WHERE presentation_id=?")
          .all(deck.id)
      ).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});
