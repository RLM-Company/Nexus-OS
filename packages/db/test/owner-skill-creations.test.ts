import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OwnerSkillStore, openDatabase, runMigrations } from "../src/index.js";
const draft = {
  name: " История ",
  summary: " Анализ ",
  instructions: " Кириллица 😀\r\n<literal> "
};
const normalized = {
  name: "История",
  summary: "Анализ",
  instructions: "Кириллица 😀\r\n<literal>"
};
async function fixture() {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return { db, store: new OwnerSkillStore(db.sqlite) };
}
describe("durable owner Skill creations", () => {
  it("replays the same accepted identity after edits and restoration, scoped to owner", async () => {
    const { db, store } = await fixture();
    try {
      const key = randomUUID();
      expect(store.creation("a", key)).toBeNull();
      const first = store.create("a", draft, key);
      expect(store.creation("b", key)).toBeNull();
      expect(store.create("a", normalized, key)).toEqual(first);
      expect(store.list("a")).toHaveLength(1);
      expect(store.get("a", first.id).versions).toHaveLength(1);
      store.update("a", first.id, 1, { ...normalized, instructions: "Changed" });
      expect(store.create("a", draft, key)).toMatchObject({ id: first.id, current_version: 2 });
      expect(store.get("a", first.id).versions[0]?.instructions).toBe("Changed");
      store.restore("a", first.id, 2, 1);
      expect(store.creation("a", key)).toMatchObject({ id: first.id, current_version: 3 });
      const other = store.create("b", normalized, key);
      expect(other.id).not.toBe(first.id);
      expect(store.create("a", draft, randomUUID()).id).not.toBe(first.id);
      expect(store.create("a", draft).id).not.toBe(first.id); // Backward compatible caller.
    } finally {
      db.close();
    }
  });
  it("rejects a changed request and keeps tombstones without resurrecting a deleted Skill", async () => {
    const { db, store } = await fixture();
    try {
      const key = randomUUID(),
        first = store.create("a", draft, key);
      expect(() => store.create("a", { ...normalized, instructions: "Other" }, key)).toThrow(
        "REQUEST_CONFLICT"
      );
      store.delete("a", first.id, 1);
      expect(store.list("a")).toEqual([]);
      expect(() => store.create("a", draft, key)).toThrow("CREATION_DELETED");
      expect(() => store.creation("a", key)).toThrow("CREATION_DELETED");
      expect(() => store.create("a", { ...normalized, name: "Other" }, key)).toThrow(
        "REQUEST_CONFLICT"
      );
      expect(db.sqlite.prepare("SELECT skill_id FROM owner_skill_creations").get()).toMatchObject({
        skill_id: null
      });
      expect(store.create("a", draft, randomUUID()).id).not.toBe(first.id);
    } finally {
      db.close();
    }
  });
  it("rolls back the new Skill when receipt recording fails", async () => {
    const { db, store } = await fixture();
    try {
      db.sqlite.exec(
        "CREATE TRIGGER receipt_failure BEFORE INSERT ON owner_skill_creations BEGIN SELECT RAISE(ABORT,'disk-write-failure'); END"
      );
      const key = randomUUID();
      expect(() => store.create("a", draft, key)).toThrow("disk-write-failure");
      expect(store.list("a")).toEqual([]);
      expect(store.creation("a", key)).toBeNull();
      expect(db.sqlite.prepare("SELECT COUNT(*) n FROM owner_skill_versions").get()).toMatchObject({
        n: 0
      });
      db.sqlite.exec("DROP TRIGGER receipt_failure");
      expect(store.create("a", draft, key)).toBeTruthy();
    } finally {
      db.close();
    }
  });
  it("honors account fence even on replay and protects immutable owner/request bindings", async () => {
    const { db, store } = await fixture();
    try {
      const key = randomUUID(),
        first = store.create("a", draft, key);
      const other = store.create("b", draft);
      expect(() =>
        db.sqlite
          .prepare("UPDATE owner_skill_creations SET skill_id=? WHERE owner_id='a'")
          .run(other.id)
      ).toThrow("SKILL_CREATION_IMMUTABLE");
      expect(() =>
        db.sqlite.prepare("UPDATE owner_skill_creations SET draft_sha256=?").run("0".repeat(64))
      ).toThrow("SKILL_CREATION_IMMUTABLE");
      expect(() =>
        db.sqlite
          .prepare(
            "INSERT INTO owner_skill_creations VALUES('b',?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',?,'at')"
          )
          .run(randomUUID(), first.id)
      ).toThrow("OWNER_MISMATCH");
      db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'quiescing','op','at','at')"
        )
        .run();
      expect(() => store.create("a", draft, key)).toThrow("OWNER_DATA_FENCED");
      expect(() => store.creation("a", key)).toThrow("OWNER_DATA_FENCED");
      expect(() => store.create("a", draft, randomUUID())).toThrow("OWNER_DATA_FENCED");
      expect(store.list("a")).toHaveLength(1);
    } finally {
      db.close();
    }
  });
  it("bounds receipts including tombstones, but resolves accepted keys at both capacity limits", async () => {
    const { db, store } = await fixture();
    try {
      const key = randomUUID(),
        first = store.create("a", draft, key);
      for (let n = 0; n < 999; n++) {
        const value = store.create("a", draft, randomUUID());
        store.delete("a", value.id, 1);
      }
      expect(() => store.create("a", draft, randomUUID())).toThrow("LIMIT_REACHED");
      expect(store.create("a", draft, key).id).toBe(first.id);
      for (let n = 1; n < 50; n++) store.create("a", draft);
      expect(store.create("a", draft, key).id).toBe(first.id);
      expect(() => store.create("a", draft)).toThrow("LIMIT_REACHED");
      expect(store.list("b")).toEqual([]);
      expect(db.sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({
        integrity_check: "ok"
      });
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("validates request keys before writing", async () => {
    const { db, store } = await fixture();
    try {
      for (const key of ["", "request", "../other", "a".repeat(1000)]) {
        expect(() => store.create("a", draft, key)).toThrow("INVALID_SKILL");
        expect(() => store.creation("a", key)).toThrow("INVALID_SKILL");
      }
      expect(store.list("a")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
