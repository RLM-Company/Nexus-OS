import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateManagerWork, ProjectMemoryInput } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { ManagerWorkStore, openDatabase, ProjectStore, runMigrations } from "../src/index.js";

const request: CreateManagerWork = {
  client_request_id: "first",
  goal: "Create document",
  worker_role: "analyst",
  max_model_requests: 3,
  max_input_tokens: 32000,
  max_output_tokens: 6000
};
const memory: ProjectMemoryInput = {
  title: "Требование",
  content: "Русский язык",
  pinned: false,
  source: { kind: "owner", reference: "Владелец" }
};
async function setup(path = ":memory:") {
  const db = openDatabase(path);
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  const a = projects.createProject("A", "a", "owner-a").project;
  const b = projects.createProject("B", "b", "owner-a").project;
  const c = projects.createProject("C", "c", "owner-b").project;
  return { db, a, b, c, store: new ManagerWorkStore(db.sqlite) };
}

describe("project memory and durable work records", () => {
  it("isolates two projects with one owner and another owner; rejects stale updates", async () => {
    const f = await setup();
    try {
      const entry = f.store.memory.create(f.a.id, "owner-a", memory)!;
      expect(f.store.memory.list(f.b.id, "owner-a")).toEqual([]);
      expect(f.store.memory.get(f.a.id, "owner-b", entry.id)).toBeNull();
      expect(f.store.memory.update(f.b.id, "owner-a", entry.id, 1, memory)).toBeNull();
      const updated = f.store.memory.update(f.a.id, "owner-a", entry.id, 1, {
        ...memory,
        content: "Новый текст",
        pinned: true
      })!;
      expect(updated.version).toBe(2);
      expect(() => f.store.memory.update(f.a.id, "owner-a", entry.id, 1, memory)).toThrow(
        "STALE_MEMORY"
      );
      expect(() => f.store.memory.control(f.a.id, "owner-a", entry.id, 1, "forget")).toThrow(
        "STALE_MEMORY"
      );
      expect(f.store.memory.list(f.a.id, "owner-a", "новый")).toHaveLength(1);
      expect(f.store.memory.list(f.a.id, "owner-a", "%")).toEqual([]);
    } finally {
      f.db.close();
    }
  });
  it("pins, searches Unicode, snapshots bounded entries and forgets future context", async () => {
    const f = await setup();
    try {
      for (let i = 0; i < 15; i++)
        f.store.memory.create(f.a.id, "owner-a", {
          ...memory,
          title: "entry " + i,
          content: "x".repeat(500)
        });
      const important = f.store.memory.create(f.a.id, "owner-a", {
        ...memory,
        title: "ＡＢＣ",
        pinned: true
      })!;
      expect(f.store.memory.list(f.a.id, "owner-a", "abc")[0]?.id).toBe(important.id);
      const snapshot = f.store.memory.snapshot(f.a.id, "owner-a");
      expect(snapshot.items[0]?.id).toBe(important.id);
      expect(snapshot.items.length).toBeLessThanOrEqual(12);
      expect(snapshot.omitted).toBeGreaterThan(0);
      expect(JSON.stringify(snapshot.items).length).toBeLessThan(8500);
      f.store.memory.control(f.a.id, "owner-a", important.id, 1, "forget");
      expect(
        f.store.memory
          .visibleSnapshot(f.a.id, "owner-a", snapshot)
          .items.some((e) => e.id === important.id)
      ).toBe(false);
      expect(
        f.db.sqlite
          .prepare("SELECT title, content FROM project_memory WHERE id = ?")
          .get(important.id)
      ).toEqual({ title: "", content: "" });
    } finally {
      f.db.close();
    }
  });
  it("claims only one work per project across two SQLite connections; another project can run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-claim-"));
    const f = await setup(join(directory, "state.db")),
      other = openDatabase(join(directory, "state.db"));
    try {
      const competitor = new ManagerWorkStore(other.sqlite);
      const first = f.store.create(f.a.id, "owner-a", "owner-a", request)!;
      const second = competitor.create(f.a.id, "owner-a", "owner-a", {
        ...request,
        client_request_id: "second"
      })!;
      const independent = competitor.create(f.b.id, "owner-a", "owner-a", request)!;
      expect(f.store.claim(first)?.status).toBe("running");
      expect(competitor.claim(first)).toBeNull();
      expect(competitor.claim(second)).toBeNull();
      expect(competitor.claim(independent)?.status).toBe("running");
      expect(competitor.pending().some((w) => w.project_id === f.a.id)).toBe(false);
    } finally {
      other.close();
      f.db.close();
      rmSync(directory, { recursive: true });
    }
  });
  it("atomically checkpoints state, immutable drafts and separate artifact versions across works", async () => {
    const f = await setup();
    try {
      let first = f.store.claim(f.store.create(f.a.id, "owner-a", "owner-a", request)!)!;
      first.stage = "publish";
      first.draft = { files: [{ name: "result.md", content: "Первый" }] };
      first = f.store.save(first, "Draft checkpoint");
      const version1 = f.store.runtime.artifacts(f.a.id, "owner-a")[0]!;
      expect(version1).toMatchObject({ version: 1, published: false, bytes: 12 });
      expect(f.store.runtime.artifact(f.a.id, "owner-a", version1.id)).toBeNull();
      const conflict = structuredClone(first);
      conflict.draft!.files[0]!.content = "Mutated";
      expect(() => f.store.save(conflict)).toThrow("IMMUTABLE_ARTIFACT_CONFLICT");
      expect(f.store.get(first.id, "owner-a")?.version).toBe(first.version);
      expect(f.store.runtime.checkpoints(f.a.id, "owner-a", first.id)).toHaveLength(first.version);
      f.store.publish(first.id, "owner-a", first.draft!);
      first.status = "completed";
      first.stage = "done";
      f.store.save(first);
      expect(f.store.runtime.artifact(f.a.id, "owner-a", version1.id)?.content).toBe("Первый");
      let second = f.store.claim(
        f.store.create(f.a.id, "owner-a", "owner-a", { ...request, client_request_id: "second" })!
      )!;
      second.stage = "publish";
      second.draft = { files: [{ name: "result.md", content: "Второй" }] };
      second = f.store.save(second);
      f.store.publish(second.id, "owner-a", second.draft!);
      second.status = "completed";
      second.stage = "done";
      f.store.save(second);
      expect(f.store.runtime.artifacts(f.a.id, "owner-a").map((v) => v.version)).toEqual([2, 1]);
      expect(f.store.runtime.artifacts(f.a.id, "owner-b")).toEqual([]);
      expect(f.store.runtime.artifact(f.b.id, "owner-a", version1.id)).toBeNull();
      expect(f.store.runtime.checkpoints(f.b.id, "owner-a", first.id)).toEqual([]);
      expect(() =>
        f.store.memory.create(f.b.id, "owner-a", {
          ...memory,
          source: { kind: "artifact", reference: version1.id }
        })
      ).toThrow("MEMORY_SOURCE_NOT_FOUND");
    } finally {
      f.db.close();
    }
  });
  it("persists safe boundaries to disk and prevents automatic replay of uncertain operations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-reopen-"));
    const f = await setup(join(directory, "state.db"));
    const entry = f.store.memory.create(f.a.id, "owner-a", memory)!;
    const work = f.store.claim(f.store.create(f.a.id, "owner-a", "owner-a", request)!)!;
    work.stage = "draft";
    work.plan = {
      summary: "Plan",
      instructions: "Write file",
      complexity: "simple",
      needs_critic: false,
      requires_external_actions: false
    };
    f.store.save(work);
    f.db.close();
    const reopened = openDatabase(join(directory, "state.db")),
      store = new ManagerWorkStore(reopened.sqlite);
    try {
      expect(store.recover()).toBe(1);
      expect(store.get(work.id, "owner-a")).toMatchObject({
        status: "paused",
        stage: "draft",
        inflight_run_id: null
      });
      expect(store.memory.get(f.a.id, "owner-a", entry.id)?.content).toBe(memory.content);
      let current = store.get(work.id, "owner-a")!;
      current.status = "running";
      current.inflight_run_id = "uncertain-request";
      current = store.save(current);
      store.recover();
      expect(store.get(work.id, "owner-a")).toMatchObject({
        status: "failed",
        error_code: "RECOVERY_REQUIRED"
      });
      expect(store.pending()).toEqual([]);
      expect(store.runtime.checkpoints(f.a.id, "owner-a", work.id)[0]?.restores_permissions).toBe(
        false
      );
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true });
    }
  });
});
