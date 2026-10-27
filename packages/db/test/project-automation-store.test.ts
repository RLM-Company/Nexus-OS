import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openDatabase, runMigrations, ProjectStore, ProjectAutomationStore } from "../src/index.js";
const scope = { owner: "a", project: "p" },
  hash = "a".repeat(64);
it("persists receipts across SQLite reopen and shares lifecycle fences between independent connections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kosmora-automation-")),
    file = join(dir, "test.db");
  let db = openDatabase(file);
  await runMigrations(db);
  new ProjectStore(db.sqlite).createEmptyProject("p", "Project", "a", "ACTIVE");
  const first = new ProjectAutomationStore(db.sqlite).create(scope, "collection", "key", hash, {
    references: []
  });
  db.close();
  db = openDatabase(file);
  const other = openDatabase(file);
  try {
    const store = new ProjectAutomationStore(db.sqlite);
    expect(store.create(scope, "collection", "key", hash, { references: [] })).toEqual(first);
    expect(() => store.create(scope, "collection", "key", "b".repeat(64), {})).toThrow(
      "IDEMPOTENCY_CONFLICT"
    );
    expect(store.get({ owner: "b", project: "p" }, "collection", first.id)).toBeNull();
    other.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'quiescing','fixture','now','now')"
      )
      .run();
    expect(() => store.create(scope, "collection", "later", hash, {})).toThrow("OWNER_DATA_FENCED");
    expect(() =>
      db.sqlite
        .prepare("UPDATE kosmora_automation_records SET version=version+1 WHERE id=?")
        .run(first.id)
    ).toThrow("IMMUTABLE");
  } finally {
    other.close();
    db.close();
    rmSync(file);
    rmdirSync(dir);
  }
});
it("caps collection enumeration honestly and checks Work fences and project inactivity inside transactions", async () => {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  try {
    new ProjectStore(db.sqlite).createEmptyProject("p", "Project", "a", "ACTIVE");
    const store = new ProjectAutomationStore(db.sqlite);
    for (let n = 0; n < 200; n++) store.create(scope, "collection", "key" + n, hash, {});
    expect(store.list(scope, "collection")).toHaveLength(200);
    expect(() => store.create(scope, "collection", "overflow", hash, {})).toThrow("QUOTA_LIMIT");
    db.sqlite.prepare("INSERT INTO work_owner_fences VALUES('a',1,1)").run();
    expect(() => store.create(scope, "suite", "suite", hash, {})).toThrow("OWNER_DATA_FENCED");
    db.sqlite.prepare("UPDATE work_owner_fences SET fenced=0 WHERE owner_id='a'").run();
    db.sqlite.prepare("UPDATE projects SET status='ARCHIVED' WHERE id='p'").run();
    expect(() => store.create(scope, "suite", "suite", hash, {})).toThrow("PROJECT_INACTIVE");
    expect(store.list(scope, "collection")).toHaveLength(200);
  } finally {
    db.close();
  }
});
