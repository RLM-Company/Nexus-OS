// Dependency-free Node 22 smoke suite. Run: node --experimental-strip-types --test packages/db/test/chat-history-search.smoke.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ChatHistorySearchStore, ftsLiteralQuery } from "../src/chat-history-search-store.ts";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const applySql = (db, filename) => {
  for (const part of readFileSync(join(migrations, filename), "utf8").split(
    "--> statement-breakpoint"
  )) {
    if (part.trim()) db.exec(part);
  }
};
const setup = (upgrade = false) => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySql(db, "0001_complex_wendigo.sql");
  applySql(db, "0018_general_chats.sql");
  applySql(db, "0020_chat_text_attachments.sql");
  applySql(db, "0021_project_message_attachments.sql");
  applySql(db, "0024_chat_archive.sql");
  if (!upgrade) applySql(db, "0034_chat_history_search.sql");
  return db;
};
const seed = (db) => {
  const at = "2026-10-06T11:00:00.000Z";
  const other = "2026-10-07T11:00:00.000Z";
  const addChat = (id, owner, title, date) =>
    db
      .prepare(
        "INSERT INTO general_chats (id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)"
      )
      .run(id, owner, title, date, date);
  const addMessage = (id, chatId, owner, content, date) =>
    db
      .prepare(
        "INSERT INTO general_chat_messages (id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES (?,?,?,'user','text',?,'completed',?,?)"
      )
      .run(id, chatId, owner, content, date, date);
  addChat("mine", "owner-a", "Летний план", at);
  addChat("theirs", "owner-b", "Чужой секрет", other);
  addChat("old", "owner-a", "Старый архив", at);
  addMessage("m1", "mine", "owner-a", "Секретный запуск <script>alert(1)</script> кофе и чай", at);
  addMessage("m2", "mine", "owner-a", "Результат проекта и лунный корабль", other);
  addMessage("m3", "theirs", "owner-b", "Секретный запуск чужих данных", other);
  addMessage("m4", "old", "owner-a", "Секретный архив историй", at);
  db.prepare("UPDATE general_chats SET archived=1 WHERE id=?").run("old");
  db.prepare(
    "INSERT INTO projects (id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?)"
  ).run("p1", "owner-a", "Лунная база", "ACTIVE", at, at);
  db.prepare(
    "INSERT INTO projects (id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?)"
  ).run("p2", "owner-b", "Секретный проект", "ACTIVE", at, at);
  db.prepare(
    "INSERT INTO chats (id,project_id,kind,created_at) VALUES ('c1','p1','main',?),('c2','p2','main',?)"
  ).run(at, at);
  db.prepare(
    "INSERT INTO messages (id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES ('pm1','p1','c1','user','text','Секретный запуск базы','completed',?,?)"
  ).run(at, at);
  db.prepare(
    "INSERT INTO messages (id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES ('pm2','p2','c2','user','text','Секретный запуск чужой базы','completed',?,?)"
  ).run(at, at);
};
const search = (db, query = "секретный", opts = {}) =>
  new ChatHistorySearchStore(db).search({ query, ownerId: "owner-a", ...opts });

test("FTS5 parser escapes operators and unicode; initial backfill searches old chats and projects", () => {
  assert.equal(ftsLiteralQuery("foo OR bar / *"), '"foo"* AND "OR"* AND "bar"*');
  const db = setup(true);
  seed(db);
  applySql(db, "0034_chat_history_search.sql");
  const result = search(db);
  assert.deepEqual(result.items.map((x) => x.message_id).sort(), ["m1", "pm1"]);
  assert.equal(result.items.find((x) => x.message_id === "m1").snippet.includes("<script>"), true);
  assert.equal(search(db, "лунная", { scope: "project" }).items[0].title, "Лунная база");
  db.close();
});

test("Owner scope, archive flags, project/date filters and bounded pages", () => {
  const db = setup();
  seed(db);
  assert.equal(search(db).items.length, 2);
  assert.deepEqual(
    search(db, "секретный", { archive: "archived" }).items.map((x) => x.message_id),
    ["m4"]
  );
  assert.equal(search(db, "секретный", { archive: "all" }).items.length, 3);
  assert.deepEqual(
    search(db, "секретный", { scope: "project", projectId: "p1" }).items.map((x) => x.message_id),
    ["pm1"]
  );
  assert.deepEqual(
    search(db, "секретный", { scope: "general" }).items.map((x) => x.message_id),
    ["m1"]
  );
  assert.equal(search(db, "секретный", { after: "2026-10-07" }).items.length, 0);
  assert.equal(search(db, "секретный", { before: "2026-10-05" }).items.length, 0);
  const first = search(db, "секретный", { archive: "all", limit: 1 });
  assert.equal(first.items.length, 1);
  assert.equal(first.next_offset, 1);
  const second = search(db, "секретный", { archive: "all", limit: 1, offset: 1 });
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].message_id, second.items[0].message_id);
  assert.equal(search(db, "секретный", { archive: "all", limit: 1, offset: 1001 }).items.length, 1);
  db.close();
});

test("Index observes new/edited/deleted messages, rename, archive and cascades", () => {
  const db = setup();
  seed(db);
  db.prepare("UPDATE general_chat_messages SET content=? WHERE id=?").run(
    "Индекс теперь находит редкое слово",
    "m1"
  );
  assert.equal(
    search(db, "секретный").items.some((x) => x.message_id === "m1"),
    false
  );
  assert.equal(search(db, "редкое").items.length, 1);
  db.prepare("UPDATE general_chats SET title=? WHERE id=?").run("Новый важный заголовок", "mine");
  assert.equal(search(db, "важный").items[0].message_id, null);
  db.prepare("UPDATE projects SET title=?,status=? WHERE id=?").run(
    "Архивная башня",
    "ARCHIVED",
    "p1"
  );
  assert.equal(search(db, "башня").items.length, 0);
  assert.equal(search(db, "башня", { archive: "archived" }).items.length, 1);
  db.prepare("DELETE FROM general_chats WHERE id=?").run("mine");
  assert.equal(search(db, "редкое", { archive: "all" }).items.length, 0);
  db.prepare("DELETE FROM projects WHERE id=?").run("p1");
  assert.equal(search(db, "базы", { archive: "all" }).items.length, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM chat_history_fts").get().n, 6); // other owner: 2 titles + 2 messages; archived general: title + message
  db.close();
});

test("Malformed MATCH text is safe; deleted and re-owned records are never disclosed", () => {
  const db = setup();
  seed(db);
  assert.equal(search(db, '" ) OR * OR <script>').items.length, 0);
  db.prepare("UPDATE general_chats SET owner_id='owner-b' WHERE id='mine'").run();
  assert.equal(search(db, "лунный", { scope: "general" }).items.length, 0);
  assert.equal(search(db, "лунный", { scope: "project" }).items.length, 0);
  db.close();
});

test("Streaming assistant only becomes searchable at terminal status (bounded reindexing)", () => {
  const db = setup();
  seed(db);
  const at = "2026-10-08T10:00:00.000Z";
  db.prepare(
    "INSERT INTO general_chat_messages (id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES ('stream1','mine','owner-a','assistant','text','','streaming',?,?)"
  ).run(at, at);
  db.prepare(
    "UPDATE general_chat_messages SET content=content || 'секвойя' WHERE id='stream1'"
  ).run();
  assert.equal(search(db, "секвойя").items.length, 0);
  db.prepare("UPDATE general_chat_messages SET status='completed' WHERE id='stream1'").run();
  assert.deepEqual(
    search(db, "секвойя").items.map((x) => x.message_id),
    ["stream1"]
  );
  db.prepare(
    "INSERT INTO messages (id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES ('pstream','p1','c1','assistant','text','берёза','streaming',?,?)"
  ).run(at, at);
  assert.equal(search(db, "берёза").items.length, 0);
  db.prepare("UPDATE messages SET status='completed' WHERE id='pstream'").run();
  assert.deepEqual(
    search(db, "берёза").items.map((x) => x.message_id),
    ["pstream"]
  );
  db.close();
});

test("Message owner or project/chat mismatch fails closed against canonical source", () => {
  const db = setup();
  seed(db);
  db.prepare("UPDATE general_chat_messages SET owner_id='owner-b' WHERE id='m1'").run();
  assert.equal(
    search(db, "секретный").items.some((x) => x.message_id === "m1"),
    false
  );
  db.prepare("UPDATE messages SET chat_id='c2' WHERE id='pm1'").run();
  assert.equal(
    search(db, "секретный").items.some((x) => x.message_id === "pm1"),
    false
  );
  db.close();
});
