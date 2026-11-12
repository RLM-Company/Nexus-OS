import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, ChatSkillStore } from "../src/index.js";

/** Skill scope + disable/revoke on the existing chat skills store. */
describe("chat skill scope and revocation", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: ChatSkillStore;
  const at = "2026-11-12T10:00:00.000Z";

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new ChatSkillStore(db.sqlite);
    db.sqlite
      .prepare(
        "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES('c1','a','c1',?,?)"
      )
      .run(at, at);
    db.sqlite
      .prepare(
        "INSERT INTO owner_skills(id,owner_id,name,summary,current_version,created_at,updated_at) VALUES('s1','a','Редактор','Стиль',1,?,?)"
      )
      .run(at, at);
    db.sqlite
      .prepare(
        "INSERT INTO owner_skill_versions(skill_id,version,owner_id,name,summary,instructions,created_at) VALUES('s1',1,'a','Редактор','Стиль','Пиши кратко',?)"
      )
      .run(at);
  });
  afterEach(() => db.close());

  it("labels selected skills as chat scope", () => {
    const selection = store.update("c1", "a", 0, [{ skill_id: "s1", version: 1 }]);
    expect(selection.items[0]).toMatchObject({ scope: "chat", name: "Редактор" });
    expect(store.get("c1", "a").items[0]!.scope).toBe("chat");
  });

  it("disabling removes every rule and keeps the version", () => {
    store.update("c1", "a", 0, [{ skill_id: "s1", version: 1 }]);
    const disabled = store.update("c1", "a", 1, []);
    expect(disabled.items).toEqual([]);
    expect(disabled.version).toBe(2);
    expect(store.get("c1", "a").items).toEqual([]);
  });

  it("a run snapshot keeps its rules even after later revocation", () => {
    store.update("c1", "a", 0, [{ skill_id: "s1", version: 1 }]);
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_runs(id,chat_id,status,created_at,updated_at) VALUES('r1','c1','queued',?,?)"
      )
      .run(at, at);
    store.snapshotRun("r1", "c1", "a");
    db.sqlite.prepare("UPDATE general_chat_runs SET status='succeeded' WHERE id='r1'").run();
    store.update("c1", "a", 1, []);
    const frozen = store.forRun("r1", "a");
    expect(frozen?.items[0]!.scope).toBe("chat");
    expect(frozen?.items[0]!.instructions).toBe("Пиши кратко");
    expect(store.get("c1", "a").items).toEqual([]);
  });

  it("rejects another owner's skill", () => {
    expect(() => store.update("c1", "a", 0, [{ skill_id: "s1", version: 2 }])).toThrow();
    expect(() => store.get("c1", "b")).toThrow();
  });
});
