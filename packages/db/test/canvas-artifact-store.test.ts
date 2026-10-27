import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CanvasArtifactStore,
  CanvasConflictError,
  CanvasLimitError
} from "../src/canvas-artifact-store.js";
import { openDatabase, runMigrations } from "../src/index.js";

const makeProject = (
  sqlite: ReturnType<typeof openDatabase>["sqlite"],
  id: string,
  owner: string
) =>
  sqlite
    .prepare(
      "INSERT INTO projects (id,owner_id,title,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE','now','now')"
    )
    .run(id, owner, id);

describe("Canvas owner boundaries, immutable history and privacy", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: CanvasArtifactStore;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new CanvasArtifactStore(db.sqlite);
    makeProject(db.sqlite, "a", "owner-a");
    makeProject(db.sqlite, "b", "owner-b");
  });
  afterEach(() => db.close());
  it("rejects foreign owner reads, versions, writes and delete", () => {
    const initial = store.create("a", "owner-a", {
      title: "Дневник",
      format: "markdown",
      content: "hello"
    })!;
    const id = initial.artifact.id;
    expect(store.list("a", "owner-b")).toBeNull();
    expect(store.get("a", "owner-b", id)).toBeNull();
    expect(store.history("a", "owner-b", id)).toBeNull();
    expect(store.getRevision("a", "owner-b", id, 1)).toBeNull();
    expect(
      store.update("a", "owner-b", id, {
        baseVersion: 1,
        title: "X",
        format: "text",
        content: "stolen"
      })
    ).toBeNull();
    expect(store.restore("a", "owner-b", id, 1, 1)).toBeNull();
    expect(store.delete("a", "owner-b", id)).toBe(false);
    expect(store.get("a", "owner-a", id)?.revision.content).toBe("hello");
  });
  it("rejects stale save without destroying draft, restores as new revision", () => {
    const first = store.create("a", "owner-a", { title: "A", format: "text", content: "one" })!;
    const id = first.artifact.id;
    const update = store.update("a", "owner-a", id, {
      baseVersion: 1,
      title: "A",
      format: "text",
      content: "two"
    })!;
    expect(update.artifact.version).toBe(2);
    const stale = "my important unsaved text";
    expect(() =>
      store.update("a", "owner-a", id, {
        baseVersion: 1,
        title: "A",
        format: "text",
        content: stale
      })
    ).toThrow(CanvasConflictError);
    expect(store.get("a", "owner-a", id)?.revision.content).toBe("two");
    expect(store.getRevision("a", "owner-a", id, 1)?.content).toBe("one");
    const restored = store.restore("a", "owner-a", id, 2, 1)!;
    expect(restored.artifact.version).toBe(3);
    expect(restored.revision.source).toEqual({ kind: "restore", revision: 1 });
    expect(store.getRevision("a", "owner-a", id, 2)?.content).toBe("two");
    expect(store.getRevision("a", "owner-a", id, 1)?.content).toBe("one");
    expect(store.history("a", "owner-a", id)?.map((x) => x.version)).toEqual([3, 2, 1]);
  });
  it("imports only completed owner chat and published completed Work as independent copies", () => {
    db.sqlite
      .prepare(
        "INSERT INTO general_chats (id,owner_id,title,created_at,updated_at) VALUES ('chat-a','owner-a','C','now','now')"
      )
      .run();
    db.sqlite
      .prepare(
        `INSERT INTO general_chat_messages
      (id,chat_id,owner_id,role,content_type,content,attachments_json,status,created_at,updated_at)
      VALUES ('msg-a','chat-a','owner-a','assistant','text','chat answer','[]','completed','now','now')`
      )
      .run();
    const chat = store.importSource("a", "owner-a", {
      title: "Copied chat",
      format: "markdown",
      source: { kind: "chat", chat_id: "chat-a", message_id: "msg-a" }
    })!;
    expect(chat.revision.content).toBe("chat answer");
    expect(
      store.importSource("b", "owner-b", {
        title: "Wrong owner",
        format: "markdown",
        source: { kind: "chat", chat_id: "chat-a", message_id: "msg-a" }
      })
    ).toBeNull();
    db.sqlite
      .prepare(
        `INSERT INTO manager_work (id,project_id,owner_id,client_request_id,version,state_json)
      VALUES ('work-a','a','owner-a','w',1,'{"status":"completed"}')`
      )
      .run();
    db.sqlite
      .prepare(
        `INSERT INTO work_artifact_versions
      (id,project_id,work_id,name,version,content,sha256,bytes,published,created_at)
      VALUES ('file-a','a','work-a','report',1,'Work answer','hash',11,1,'now')`
      )
      .run();
    const copy = store.importSource("a", "owner-a", {
      title: "Work copy",
      format: "text",
      source: { kind: "work", work_artifact_id: "file-a" }
    })!;
    expect(copy.revision.content).toBe("Work answer");
    store.update("a", "owner-a", copy.artifact.id, {
      baseVersion: 1,
      title: "Edited",
      format: "text",
      content: "changed"
    });
    expect(
      (
        db.sqlite.prepare("SELECT content FROM work_artifact_versions WHERE id='file-a'").get() as {
          content: string;
        }
      ).content
    ).toBe("Work answer");
    db.sqlite.prepare("UPDATE work_artifact_versions SET published=0 WHERE id='file-a'").run();
    expect(
      store.importSource("a", "owner-a", {
        title: "Not published",
        format: "text",
        source: { kind: "work", work_artifact_id: "file-a" }
      })
    ).toBeNull();
    db.sqlite.prepare("UPDATE general_chat_messages SET status='failed' WHERE id='msg-a'").run();
    expect(
      store.importSource("a", "owner-a", {
        title: "Not completed",
        format: "text",
        source: { kind: "chat", chat_id: "chat-a", message_id: "msg-a" }
      })
    ).toBeNull();
  });
  it("enforces UTF-8 bounds and deletes project artifacts via FK cascade", () => {
    expect(() =>
      store.create("a", "owner-a", { title: "x", format: "text", content: "🚀".repeat(150_000) })
    ).toThrow("CANVAS_INVALID_CONTENT");
    const item = store.create("a", "owner-a", {
      title: "Safe",
      format: "html",
      content: "<script>fetch('https://evil')</script>"
    })!;
    expect(store.get("a", "owner-a", item.artifact.id)).not.toBeNull();
    db.sqlite.prepare("DELETE FROM projects WHERE id='a'").run();
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_artifacts").get() as { n: number }).n
    ).toBe(0);
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_revisions").get() as { n: number }).n
    ).toBe(0);
  });
  it("has bounded paginated privacy export and removes only owned editor data", () => {
    const a = store.create("a", "owner-a", { title: "One", format: "text", content: "private" })!;
    store.update("a", "owner-a", a.artifact.id, {
      baseVersion: 1,
      title: "Two",
      format: "text",
      content: "new"
    });
    store.create("b", "owner-b", { title: "Another", format: "text", content: "other" });
    expect(store.privacyExport("owner-a").items.map((row) => row.revision.version)).toEqual([1, 2]);
    expect(store.privacyExport("owner-b").items).toHaveLength(1);
    expect(() => store.privacyExport("owner-a", "malformed")).toThrow(CanvasLimitError);
    const wiped = store.privacyDelete("owner-a");
    expect(wiped.artifacts).toBe(1);
    expect(wiped.revisions).toBe(2);
    expect(store.privacyExport("owner-a").items).toHaveLength(0);
    expect(store.privacyExport("owner-b").items).toHaveLength(1);
    expect((db.sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n).toBe(
      2
    );
  });
  it("enforces revision/artifact limits atomically and preserves the last committed history", () => {
    const item = store.create("a", "owner-a", {
      title: "Limited",
      format: "text",
      content: "one"
    })!;
    for (let version = 1; version < 500; version++) {
      store.update("a", "owner-a", item.artifact.id, {
        baseVersion: version,
        title: "Limited",
        format: "text",
        content: String(version + 1)
      });
    }
    expect(() =>
      store.update("a", "owner-a", item.artifact.id, {
        baseVersion: 500,
        title: "Late",
        format: "text",
        content: "lost"
      })
    ).toThrow("CANVAS_REVISION_LIMIT");
    expect(store.get("a", "owner-a", item.artifact.id)?.artifact.version).toBe(500);
    expect(store.getRevision("a", "owner-a", item.artifact.id, 1)?.content).toBe("one");
    expect(store.getRevision("a", "owner-a", item.artifact.id, 500)?.content).toBe("500");
    for (let count = 1; count < 200; count++) {
      store.create("a", "owner-a", { title: `Note ${count}`, format: "text", content: "bounded" });
    }
    expect(() =>
      store.create("a", "owner-a", {
        title: "Overflow",
        format: "text",
        content: "bounded"
      })
    ).toThrow("CANVAS_ARTIFACT_LIMIT");
    expect(store.list("a", "owner-a", 100, 100)).toHaveLength(100);
    expect(store.list("a", "owner-a", 100, 200)).toHaveLength(0);
    expect(
      store.create("b", "owner-b", { title: "Other", format: "text", content: "available" })
    ).not.toBeNull();
  });
});

describe("Canvas protected revision SQL", () => {
  it("prevents direct revision UPDATE/DELETE, but allows parent removal cascade", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      makeProject(db.sqlite, "z", "owner");
      const store = new CanvasArtifactStore(db.sqlite);
      const created = store.create("z", "owner", {
        title: "Protected",
        format: "text",
        content: "one"
      })!;
      expect(() =>
        db.sqlite
          .prepare("UPDATE canvas_revisions SET content='changed' WHERE artifact_id=?")
          .run(created.artifact.id)
      ).toThrow("CANVAS_IMMUTABLE_REVISION");
      expect(() =>
        db.sqlite
          .prepare("DELETE FROM canvas_revisions WHERE artifact_id=?")
          .run(created.artifact.id)
      ).toThrow("CANVAS_IMMUTABLE_REVISION");
      db.sqlite.prepare("DELETE FROM projects WHERE id='z'").run();
      expect(
        db.sqlite
          .prepare("SELECT * FROM canvas_revisions WHERE artifact_id=?")
          .get(created.artifact.id)
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
