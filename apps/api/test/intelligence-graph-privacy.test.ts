import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { LOCAL_DEVELOPMENT_IDENTITY, StaticIdentityResolver } from "../src/identity.js";
import { registerIntelligenceGraphWorkspaceRoutes } from "../src/intelligence-graph-workspace-routes.js";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphWorkspaceService, type IntelligenceGraphEdit } from "@cosmora/core";
import { SqliteIntelligenceGraphWorkspaceRepository } from "@cosmora/db";
import { intelligenceGraphPrivacyAdapter } from "../src/intelligence-graph-privacy.js";

const schema = readFileSync(
  new URL("../../../docs/handoff/INTELLIGENCE_GRAPH_MIGRATION_PROPOSAL.sql", import.meta.url),
  "utf8"
);
const imports = readFileSync(
  new URL("../../../docs/handoff/INTELLIGENCE_GRAPH_IMPORT_RECOVERY_PROPOSAL.sql", import.meta.url),
  "utf8"
);
const packet = {
  format: "kosmora.intelligence-graph.v1",
  title: "Private graph",
  nodes: [{ key: "a", kind: "Claim", label: "Свой тезис", detail: "Точная\r\nистория" }],
  edges: []
};
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "graph-privacy-")),
    filename = join(directory, "test.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT); INSERT INTO projects VALUES('p-a','owner-a','ACTIVE'),('p-b','owner-b','ACTIVE'); CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT PRIMARY KEY,epoch INTEGER,state TEXT); CREATE TABLE retained_accounting(id TEXT); INSERT INTO retained_accounting VALUES('keep')"
  );
  db.exec(schema);
  db.exec(imports);
  const store = new SqliteIntelligenceGraphWorkspaceRepository(db),
    service = new IntelligenceGraphWorkspaceService(store),
    adapter = intelligenceGraphPrivacyAdapter(store);
  const preview = service.previewImport(packet);
  const first = service.importPackage(
    "owner-a",
    "p-a",
    packet,
    preview.sha256,
    "attempt_0123456789abcdef"
  );
  const changed = service.edit("owner-a", "p-a", first.graph_id, 1, {
    kind: "rename",
    title: "Changed"
  });
  const second = service.create("owner-b", "p-b", "Foreign graph");
  const fence = (state: string, epoch = 1, owner = "owner-a") =>
    db
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET epoch=excluded.epoch,state=excluded.state"
      )
      .run(owner, epoch, state);
  return {
    directory,
    filename,
    db,
    store,
    service,
    adapter,
    first,
    changed,
    second,
    preview,
    fence
  };
};
const close = (f: ReturnType<typeof fixture>) => {
  f.db.close();
  rmSync(f.directory, { recursive: true, force: true });
};

describe("complete fenced graph privacy lifecycle", () => {
  it("exports all owned history, archived graphs and receipt tombstones without foreign records", async () => {
    const f = fixture();
    try {
      const doomed = f.service.importPackage(
        "owner-a",
        "p-a",
        packet,
        f.preview.sha256,
        "deleted_0123456789abcdef"
      );
      f.db
        .prepare("DELETE FROM intelligence_graph_workspaces WHERE graph_id=?")
        .run(doomed.graph_id);
      f.db.prepare("UPDATE projects SET status='ARCHIVED' WHERE id='p-a'").run();
      f.fence("quiescing", 4);
      expect(await f.adapter.quiesce("owner-a", 4)).toEqual({ drained: true, fence_epoch: 4 });
      const exported = await f.adapter.export("owner-a");
      expect(exported.complete).toBe(true);
      expect(exported.originals).toEqual([]);
      expect(exported.records.intelligence_graph_workspaces).toHaveLength(1);
      expect(exported.records.intelligence_graph_revisions).toHaveLength(2);
      expect(exported.records.intelligence_graph_import_receipts).toHaveLength(2);
      expect(JSON.stringify(exported)).toContain("Точная\\r\\nистория");
      expect(JSON.stringify(exported)).not.toContain("Foreign graph");
      expect(exported.records.intelligence_graph_import_receipts).toContainEqual(
        expect.objectContaining({ graph_id: null })
      );
      expect(() => f.store.privacyExport("owner-a", 4, { maxRecords: 1 })).toThrow(
        "GRAPH_PRIVACY_EXPORT_LIMIT"
      );
      expect(() => f.store.privacyExport("owner-a", 4, { maxBytes: 1 })).toThrow(
        "GRAPH_PRIVACY_EXPORT_LIMIT"
      );
      expect(f.store.get("owner-b", "p-b", f.second.graph_id)).toEqual(f.second);
    } finally {
      close(f);
    }
  });
  it("blocks every synchronous writer under the durable fence and preserves other owners", async () => {
    const f = fixture();
    try {
      f.fence("quiescing", 2);
      await f.adapter.quiesce("owner-a", 2);
      const operations = [
        () => f.service.create("owner-a", "p-a", "Late"),
        () =>
          f.service.edit("owner-a", "p-a", f.first.graph_id, 2, { kind: "rename", title: "Late" }),
        () => f.service.restore("owner-a", "p-a", f.first.graph_id, 2, 1),
        () => f.service.importPackage("owner-a", "p-a", packet, f.preview.sha256),
        () =>
          f.service.importPackage(
            "owner-a",
            "p-a",
            packet,
            f.preview.sha256,
            "attempt_0123456789abcdef"
          ),
        () =>
          f.service.importPackage(
            "owner-a",
            "p-a",
            packet,
            f.preview.sha256,
            "fresh_0123456789abcdef"
          )
      ];
      for (const write of operations) expect(write).toThrow("GRAPH_OWNER_FENCED");
      expect(f.store.get("owner-a", "p-a", f.first.graph_id)).toEqual(f.changed);
      expect(f.service.create("owner-b", "p-b", "Still active").title).toBe("Still active");
      f.adapter.resume("owner-a");
      expect(() => f.service.create("owner-a", "p-a", "Cannot unfreeze")).toThrow(
        "GRAPH_OWNER_FENCED"
      );
      await expect(f.adapter.export("owner-a")).rejects.toThrow("NOT_QUIESCED");
    } finally {
      close(f);
    }
  });
  it("keeps fences after reopen and rejects stale adapter epochs across connections", async () => {
    const f = fixture();
    let other: DatabaseSync | undefined;
    try {
      f.fence("quiescing", 3);
      await f.adapter.quiesce("owner-a", 3);
      other = new DatabaseSync(f.filename);
      other.exec("PRAGMA foreign_keys=ON");
      const fresh = new SqliteIntelligenceGraphWorkspaceRepository(other);
      expect(() => fresh.create({ ...f.first, graph_id: "restart-attempt" })).toThrow(
        "GRAPH_OWNER_FENCED"
      );
      const adapter = intelligenceGraphPrivacyAdapter(fresh);
      await expect(adapter.export("owner-a")).rejects.toThrow("NOT_QUIESCED");
      await adapter.quiesce("owner-a", 3);
      f.fence("quiescing", 4);
      await expect(adapter.export("owner-a")).rejects.toThrow("FENCE_MISMATCH");
      await expect(f.adapter.quiesce("owner-a", 3)).rejects.toThrow("FENCE_MISMATCH");
      await adapter.quiesce("owner-a", 4);
      expect((await adapter.export("owner-a")).complete).toBe(true);
    } finally {
      other?.close();
      close(f);
    }
  });
  it("deletes owned graphs, revisions and receipts idempotently, retaining projects/accounting and foreign data", async () => {
    const f = fixture();
    try {
      f.fence("quiescing", 5);
      await f.adapter.quiesce("owner-a", 5);
      await expect(f.adapter.delete("owner-a", 5)).rejects.toThrow("FENCE_MISMATCH");
      f.fence("deleting", 5);
      expect(await f.adapter.delete("owner-a", 5)).toEqual({ deleted_records: 4 });
      expect(await f.adapter.delete("owner-a", 5)).toEqual({ deleted_records: 0 });
      expect(f.store.get("owner-a", "p-a", f.first.graph_id)).toBeNull();
      expect(f.store.getRevision("owner-a", "p-a", f.first.graph_id, 1)).toBeNull();
      expect(f.store.getImportReceipt("owner-a", "p-a", "attempt_0123456789abcdef")).toBeNull();
      expect(f.store.get("owner-b", "p-b", f.second.graph_id)).toEqual(f.second);
      expect(f.db.prepare("SELECT * FROM retained_accounting").all()).toHaveLength(1);
      expect(f.db.prepare("SELECT * FROM projects").all()).toHaveLength(2);
      expect(() => f.service.create("owner-a", "p-a", "Late recreate")).toThrow(
        "GRAPH_OWNER_FENCED"
      );
    } finally {
      close(f);
    }
  });
  it("rolls deletion back as one transaction, retaining the durable fence on failure", async () => {
    const f = fixture();
    try {
      f.fence("quiescing", 6);
      await f.adapter.quiesce("owner-a", 6);
      f.fence("deleting", 6);
      f.db.exec(
        "CREATE TRIGGER fail_delete BEFORE DELETE ON intelligence_graph_workspaces WHEN OLD.owner_id='owner-a' BEGIN SELECT RAISE(ABORT,'injected deletion failure'); END"
      );
      await expect(f.adapter.delete("owner-a", 6)).rejects.toThrow("injected");
      expect(f.store.getImportReceipt("owner-a", "p-a", "attempt_0123456789abcdef")?.graph_id).toBe(
        f.first.graph_id
      );
      expect(f.store.getRevision("owner-a", "p-a", f.first.graph_id, 1)).toEqual(f.first);
      expect(() => f.service.create("owner-a", "p-a", "Late")).toThrow("GRAPH_OWNER_FENCED");
      f.db.exec("DROP TRIGGER fail_delete");
      expect((await f.adapter.delete("owner-a", 6)).deleted_records).toBe(4);
    } finally {
      close(f);
    }
  });
  it("fails an inconsistent historical export rather than returning a partial success", async () => {
    const f = fixture();
    try {
      const corrupt = { ...f.first, owner_id: "owner-b" };
      f.db
        .prepare(
          "UPDATE intelligence_graph_workspace_revisions SET snapshot_json=? WHERE graph_id=? AND revision=1"
        )
        .run(JSON.stringify(corrupt), f.first.graph_id);
      f.fence("quiescing", 7);
      await f.adapter.quiesce("owner-a", 7);
      await expect(f.adapter.export("owner-a")).rejects.toThrow("INCONSISTENT");
      expect(() => f.service.create("owner-a", "p-a", "Late")).toThrow("GRAPH_OWNER_FENCED");
    } finally {
      close(f);
    }
  });
  it("fails closed without installed lifecycle schema and performs no startup DDL", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT); INSERT INTO projects VALUES('p-a','owner-a','ACTIVE')"
      );
      db.exec(schema);
      db.exec(imports);
      const service = new IntelligenceGraphWorkspaceService(
        new SqliteIntelligenceGraphWorkspaceRepository(db)
      );
      expect(() => service.create("owner-a", "p-a", "Blocked")).toThrow(
        "GRAPH_PRIVACY_UNAVAILABLE"
      );
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='kosmora_owner_data_lifecycle'").get()
      ).toBeUndefined();
      expect(db.prepare("SELECT * FROM intelligence_graph_workspaces").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("graph HTTP privacy prerequisites", () => {
  it("reports a locked owner as 423 and unavailable lifecycle schema as 503", async () => {
    const f = fixture(),
      app = Fastify();
    try {
      registerIntelligenceGraphWorkspaceRoutes(app, {
        enabled: true,
        service: f.service,
        identity: new StaticIdentityResolver({
          ...LOCAL_DEVELOPMENT_IDENTITY,
          owner_id: "owner-a"
        }),
        projects: {
          getProject: (project, owner) =>
            project === "p-a" && owner === "owner-a"
              ? {
                  id: project,
                  title: "Own project",
                  status: "ACTIVE",
                  created_at: "2026-10-19T00:00:00Z",
                  updated_at: "2026-10-19T00:00:00Z"
                }
              : null
        }
      });
      f.fence("quiescing", 8);
      const locked = await app.inject({
        method: "POST",
        url: "/api/v1/projects/p-a/intelligence-graphs",
        payload: { title: "Locked" }
      });
      expect(locked.statusCode).toBe(423);
      expect(locked.json<{ error: string }>().error).toBe("GRAPH_OWNER_FENCED");
      f.db.exec("DROP TABLE kosmora_owner_data_lifecycle");
      const unavailable = await app.inject({
        method: "POST",
        url: "/api/v1/projects/p-a/intelligence-graphs",
        payload: { title: "Unavailable" }
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json<{ error: string }>().error).toBe("GRAPH_PRIVACY_UNAVAILABLE");
      expect(f.store.list("owner-a", "p-a", 20)).toHaveLength(1);
    } finally {
      await app.close();
      close(f);
    }
  });
});

it("persists every conflict review across restart, exports all versions and deletes them under the fence", async () => {
  const f = fixture();
  let restarted: DatabaseSync | undefined;
  try {
    let graph = f.changed;
    const edit = (operation: IntelligenceGraphEdit) =>
      (graph = f.service.edit("owner-a", "p-a", graph.graph_id, graph.revision, operation));
    edit({
      kind: "add_node",
      node_kind: "Claim",
      label: "Other position",
      detail: "Different text"
    });
    const refs = graph.nodes.map((n) => ({ id: n.node_id, version: n.node_version }));
    edit({ kind: "open_conflict", subject: refs[0]!, positions: [refs[0]!, refs[1]!] });
    const openRevision = graph.revision,
      id = graph.conflicts![0]!.conflict_id;
    edit({
      kind: "add_node",
      node_kind: "Decision",
      label: "Resolution",
      detail: "Owner rationale"
    });
    edit({
      kind: "resolve_conflict",
      conflict_id: id,
      resolution: { id: graph.nodes.at(-1)!.node_id, version: 1 }
    });
    restarted = new DatabaseSync(f.filename);
    const store = new SqliteIntelligenceGraphWorkspaceRepository(restarted);
    expect(store.get("owner-a", "p-a", graph.graph_id)?.conflicts).toEqual(graph.conflicts);
    expect(
      store.getRevision("owner-a", "p-a", graph.graph_id, openRevision)?.conflicts![0]!.status
    ).toBe("open");
    f.fence("quiescing", 20);
    await f.adapter.quiesce("owner-a", 20);
    const exported = await f.adapter.export("owner-a");
    expect(exported.records.intelligence_graph_revisions).toHaveLength(graph.revision);
    expect(JSON.stringify(exported)).toContain("Owner rationale");
    f.fence("deleting", 20);
    await f.adapter.delete("owner-a", 20);
    expect(store.getRevision("owner-a", "p-a", graph.graph_id, openRevision)).toBeNull();
    expect(f.store.get("owner-b", "p-b", f.second.graph_id)).toEqual(f.second);
  } finally {
    restarted?.close();
    close(f);
  }
});

it.each([
  "foreign_owner",
  "foreign_position",
  "duplicate_id",
  "malformed",
  "invalid_time",
  "invalid_floor"
])("rejects corrupt historical conflicts in complete privacy export: %s", async (kind) => {
  const f = fixture();
  try {
    const content = {
      ...packet,
      nodes: [...packet.nodes, { key: "b", kind: "Claim", label: "B", detail: "B" }],
      conflicts: [{ subject: "a", positions: ["a", "b"], resolution: null }]
    };
    const preview = f.service.previewImport(content);
    const graph = f.service.importPackage("owner-a", "p-a", content, preview.sha256);
    const conflict = graph.conflicts![0]!;
    if (kind === "foreign_owner") conflict.owner_id = "owner-b";
    if (kind === "foreign_position") conflict.position_refs[0] = { id: "foreign", version: 1 };
    if (kind === "duplicate_id") graph.conflicts!.push(structuredClone(conflict));
    if (kind === "invalid_time") conflict.created_at = "2026-99-99T00:00:00Z";
    if (kind === "invalid_floor") graph.version_floor = 1000;
    const corrupt = kind === "malformed" ? { ...graph, conflicts: [null] } : graph;
    f.db
      .prepare("UPDATE intelligence_graph_workspace_revisions SET snapshot_json=? WHERE graph_id=?")
      .run(JSON.stringify(corrupt), graph.graph_id);
    f.fence("quiescing", 21);
    await f.adapter.quiesce("owner-a", 21);
    await expect(f.adapter.export("owner-a")).rejects.toThrow("INCONSISTENT");
  } finally {
    close(f);
  }
});
