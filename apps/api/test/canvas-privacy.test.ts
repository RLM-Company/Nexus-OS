import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, CanvasArtifactStore } from "@cosmora/db";
import { canvasPrivacyAdapter } from "../src/canvas/canvas-privacy.js";

describe("Canvas B22 privacy lifecycle adapter", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: CanvasArtifactStore;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    db.sqlite
      .prepare(
        "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES ('a','owned','a','ACTIVE','now','now'),('b','other','b','ACTIVE','now','now')"
      )
      .run();
    // Exercise the actual managed slot 30 lifecycle table.
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES ('owned','quiescing',3,'canvas-test','now','now')"
      )
      .run();
    store = new CanvasArtifactStore(db.sqlite);
  });
  afterEach(() => db.close());
  it("fences writes, exports complete owner revisions and deletes only Canvas", async () => {
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='owned'")
      .run();
    const item = store.create("a", "owned", {
      title: "Первый",
      format: "text",
      content: "original"
    })!;
    store.update("a", "owned", item.artifact.id, {
      baseVersion: 1,
      title: "Второй",
      format: "text",
      content: "revised"
    });
    store.create("b", "other", { title: "Other", format: "text", content: "foreign" });
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='quiescing' WHERE owner_id='owned'")
      .run();
    const adapter = canvasPrivacyAdapter(store);
    expect(adapter.id).toBe("canvas");
    await expect(adapter.quiesce("owned", 3)).resolves.toEqual({ drained: true, fence_epoch: 3 });
    expect(() =>
      store.update("a", "owned", item.artifact.id, {
        baseVersion: 2,
        title: "Late",
        format: "text",
        content: "late"
      })
    ).toThrow("CANVAS_OWNER_FENCED");
    const snapshot = await adapter.export("owned");
    expect(snapshot.complete).toBe(true);
    expect(snapshot.originals).toHaveLength(0);
    expect(snapshot.records.canvas_revisions).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain("foreign");
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owned'")
      .run();
    await expect(adapter.delete("owned", 3)).resolves.toEqual({ deleted_records: 3 });
    expect(store.list("b", "other")?.length).toBe(1);
    expect((db.sqlite.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n).toBe(
      2
    );
    expect(store.privacyExport("owned").items).toHaveLength(0);
  });
  it("refuses a wrong epoch, an unfenced export, and early deletion", async () => {
    const adapter = canvasPrivacyAdapter(store);
    await expect(adapter.quiesce("owned", 2)).rejects.toThrow("CANVAS_PRIVACY_FENCE_MISMATCH");
    await expect(adapter.delete("owned", 3)).rejects.toThrow("CANVAS_PRIVACY_FENCE_MISMATCH");
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='owned'")
      .run();
    await expect(adapter.export("owned")).rejects.toThrow("CANVAS_PRIVACY_EXPORT_NOT_QUIESCED");
  });
  it("consumes multiple export pages and refuses to claim completeness beyond the segment bound", async () => {
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='owned'")
      .run();
    const item = store.create("a", "owned", {
      title: "History",
      format: "text",
      content: "first"
    })!;
    for (let version = 1; version < 35; version++) {
      store.update("a", "owned", item.artifact.id, {
        baseVersion: version,
        title: "History",
        format: "text",
        content: `revision ${version + 1}`
      });
    }
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='quiescing' WHERE owner_id='owned'")
      .run();
    const adapter = canvasPrivacyAdapter(store);
    expect((await adapter.export("owned")).records.canvas_revisions).toHaveLength(35);
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='owned'")
      .run();
    const large = store.create("a", "owned", {
      title: "Large",
      format: "text",
      content: "x".repeat(512 * 1024)
    })!;
    for (let version = 1; version < 25; version++) {
      store.update("a", "owned", large.artifact.id, {
        baseVersion: version,
        title: "Large",
        format: "text",
        content: "x".repeat(512 * 1024)
      });
    }
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='quiescing' WHERE owner_id='owned'")
      .run();
    await expect(adapter.export("owned")).rejects.toThrow(
      "CANVAS_PRIVACY_SEGMENTED_EXPORT_REQUIRED"
    );
  });
});
