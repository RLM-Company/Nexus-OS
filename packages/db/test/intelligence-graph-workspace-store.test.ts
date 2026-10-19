import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { IntelligenceGraphWorkspace } from "@cosmora/contracts";
import { SqliteIntelligenceGraphWorkspaceRepository } from "../src/index.js";

const directories: string[] = [];
const schemaSql = readFileSync(
  new URL("../../../docs/handoff/INTELLIGENCE_GRAPH_MIGRATION_PROPOSAL.sql", import.meta.url),
  "utf8"
);

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "graph-workspace-"));
  directories.push(dir);
  const filename = join(dir, "test.sqlite");
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL)"
  );
  db.exec(
    "INSERT INTO projects VALUES ('project-a', 'owner-a', 'ACTIVE'), ('project-b', 'owner-b', 'ACTIVE'), ('archived', 'owner-a', 'ARCHIVED')"
  );
  db.exec(schemaSql);
  db.exec(
    "CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, state TEXT NOT NULL)"
  );
  return { db, filename, store: new SqliteIntelligenceGraphWorkspaceRepository(db) };
};
const graph = (id: string): IntelligenceGraphWorkspace => ({
  graph_id: id,
  owner_id: "owner-a",
  project_id: "project-a",
  title: "Real user graph",
  revision: 1,
  created_at: "2026-10-09T00:00:00.000Z",
  updated_at: "2026-10-09T00:00:00.000Z",
  restored_from_revision: null,
  nodes: [],
  edges: [],
  records: []
});

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SQLite intelligence graph workspace store", () => {
  it("persists immutable revision snapshots after database restart", () => {
    const { db, filename, store } = fixture();
    const original = graph("graph-a");
    expect(store.create(original)).toEqual(original);
    const updated: IntelligenceGraphWorkspace = {
      ...original,
      revision: 2,
      title: "Updated",
      updated_at: "2026-10-09T01:00:00.000Z"
    };
    expect(store.save(updated, 1, "Edited")).toEqual(updated);
    db.close();
    const reopened = new DatabaseSync(filename);
    reopened.exec("PRAGMA foreign_keys = ON");
    const nextStore = new SqliteIntelligenceGraphWorkspaceRepository(reopened);
    expect(nextStore.get("owner-a", "project-a", "graph-a")).toEqual(updated);
    expect(nextStore.getRevision("owner-a", "project-a", "graph-a", 1)).toEqual(original);
    expect(nextStore.listRevisions("owner-a", "project-a", "graph-a", 20)).toEqual([
      expect.objectContaining({ revision: 2, summary: "Edited" }),
      expect.objectContaining({ revision: 1, summary: "Graph created" })
    ]);
    reopened.close();
  });

  it("fences owner/project at every read, history lookup and write", () => {
    const { db, store } = fixture();
    const original = graph("graph-private");
    store.create(original);
    expect(store.get("owner-b", "project-a", original.graph_id)).toBeNull();
    expect(store.get("owner-a", "project-b", original.graph_id)).toBeNull();
    expect(store.list("owner-b", "project-a", 20)).toEqual([]);
    expect(store.listRevisions("owner-b", "project-a", original.graph_id, 20)).toEqual([]);
    expect(store.getRevision("owner-b", "project-a", original.graph_id, 1)).toBeNull();
    expect(store.create({ ...original, graph_id: "invalid", project_id: "project-b" })).toBeNull();
    expect(store.create({ ...original, graph_id: "inactive", project_id: "archived" })).toBeNull();
    expect(store.save({ ...original, owner_id: "owner-b", revision: 2 }, 1, "forge")).toBeNull();
    expect(
      store.save({ ...original, project_id: "project-b", revision: 2 }, 1, "forge")
    ).toBeNull();
    expect(store.get("owner-a", "project-a", original.graph_id)).toEqual(original);
    db.prepare("UPDATE projects SET status = 'ARCHIVED' WHERE id = ?").run("project-a");
    expect(store.save({ ...original, revision: 2 }, 1, "archived write")).toBeNull();
    db.close();
  });

  it("rejects stale writes without appending an orphan revision", () => {
    const { db, store } = fixture();
    const original = graph("cas");
    store.create(original);
    const updated = { ...original, revision: 2 };
    expect(store.save(updated, 1, "first")).toEqual(updated);
    expect(store.save({ ...original, revision: 2, title: "stale" }, 1, "late")).toBeNull();
    expect(store.listRevisions("owner-a", "project-a", "cas", 50)).toHaveLength(2);
    db.close();
  });
});

describe("metadata graph library pages", () => {
  it("uses stable keyset continuation with same-time rows and literal Unicode title search", () => {
    const { db, store } = fixture();
    try {
      const titles = ["ЁЖИК — История", "ёжик — 100%", "Exact_100%", "Other title"];
      for (let i = 0; i < 45; i++)
        store.create({
          ...graph("graph-" + String(i).padStart(3, "0")),
          title: titles[i % titles.length]!
        });
      const first = store.listPage("owner-a", "project-a", { limit: 20, query: "" });
      expect(first.items).toHaveLength(20);
      expect(first.has_more).toBe(true);
      const last = first.items.at(-1)!;
      const second = store.listPage("owner-a", "project-a", {
        limit: 20,
        query: "",
        before: { graph_id: last.graph_id, updated_at: last.updated_at }
      });
      const final = store.listPage("owner-a", "project-a", {
        limit: 20,
        query: "",
        before: {
          graph_id: second.items.at(-1)!.graph_id,
          updated_at: second.items.at(-1)!.updated_at
        }
      });
      expect(final.items).toHaveLength(5);
      expect(final.has_more).toBe(false);
      expect(
        new Set([...first.items, ...second.items, ...final.items].map((g) => g.graph_id)).size
      ).toBe(45);
      expect(
        store
          .listPage("owner-a", "project-a", { limit: 20, query: "ЁжИк" })
          .items.every((g) => g.title.toLocaleLowerCase("ru-RU").includes("ёжик"))
      ).toBe(true);
      const percent = store.listPage("owner-a", "project-a", { limit: 20, query: "%" });
      expect(percent.items.length).toBeGreaterThan(0);
      expect(percent.items.every((g) => g.title.includes("%"))).toBe(true);
      expect(store.listPage("owner-b", "project-a", { limit: 20, query: "" }).items).toEqual([]);
      expect(store.listPage("owner-a", "project-b", { limit: 20, query: "" }).items).toEqual([]);
      expect(() => store.listPage("owner-a", "project-a", { limit: 100, query: "" })).toThrow();
      expect(JSON.stringify(first.items)).not.toContain("nodes");
    } finally {
      db.close();
    }
  });
});
