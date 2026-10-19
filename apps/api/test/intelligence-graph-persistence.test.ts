import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { IntelligenceGraphWorkspaceService } from "@cosmora/core";
import { SqliteIntelligenceGraphWorkspaceRepository } from "@cosmora/db";

const proposal = readFileSync(
  new URL("../../../docs/handoff/INTELLIGENCE_GRAPH_MIGRATION_PROPOSAL.sql", import.meta.url),
  "utf8"
);

describe("graph history on durable SQLite", () => {
  it("retains revised node/edge history, portable source hashes and CAS after reopening", () => {
    const dir = mkdtempSync(join(tmpdir(), "graph-history-"));
    const filename = join(dir, "graph.sqlite");
    let db = new DatabaseSync(filename);
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY, owner_id TEXT, status TEXT); INSERT INTO projects VALUES('project-a','owner-a','ACTIVE')"
      );
      db.exec(proposal);
      db.exec(
        "CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, state TEXT NOT NULL)"
      );
      let tick = 0;
      const service = new IntelligenceGraphWorkspaceService(
        new SqliteIntelligenceGraphWorkspaceRepository(db),
        () => new Date(Date.UTC(2026, 9, 18, 0, 0, tick++)).toISOString()
      );
      const packet = service.previewImport({
        format: "kosmora.intelligence-graph.v1",
        title: "Пример",
        nodes: [
          { key: "a", kind: "Claim", label: "Утверждение", detail: "Версия 1\r\nцитата" },
          { key: "b", kind: "Source", label: "Источник", detail: "Текст источника" }
        ],
        edges: [{ relation: "SUPPORTS", from: "b", to: "a" }]
      });
      const first = service.importPackage("owner-a", "project-a", packet.package, packet.sha256);
      const initialExport = service.exportPackage("owner-a", "project-a", first.graph_id);
      const a = { id: first.nodes[0]!.node_id, version: 1 };
      const changed = service.edit("owner-a", "project-a", first.graph_id, 1, {
        kind: "revise_node",
        node: a,
        label: "Версия 2",
        detail: "Изменено"
      });
      const last = service.edit("owner-a", "project-a", first.graph_id, 2, {
        kind: "remove_node",
        node: { ...a, version: 2 }
      });
      db.close();
      db = new DatabaseSync(filename);
      db.exec("PRAGMA foreign_keys=ON");
      const reopened = new IntelligenceGraphWorkspaceService(
        new SqliteIntelligenceGraphWorkspaceRepository(db)
      );
      expect(reopened.get("owner-a", "project-a", first.graph_id)).toEqual(last);
      expect(reopened.revision("owner-a", "project-a", first.graph_id, 2)).toEqual(changed);
      expect(reopened.exportPackage("owner-a", "project-a", first.graph_id, 1).sha256).toBe(
        initialExport.sha256
      );
      expect(
        reopened.revision("owner-a", "project-a", first.graph_id, 1).nodes[0]?.source_ref.location
      ).toContain(packet.sha256);
      expect(() => reopened.restore("owner-a", "project-a", first.graph_id, 2, 1)).toThrow(
        "Graph revision changed"
      );
      expect(reopened.revisions("owner-a", "project-a", first.graph_id)).toHaveLength(3);
      const restored = reopened.restore("owner-a", "project-a", first.graph_id, 3, 1);
      expect(restored.nodes).toEqual(first.nodes);
      expect(restored.edges).toEqual(first.edges);
      expect(reopened.revision("owner-a", "project-a", first.graph_id, 3)).toEqual(last);
      expect(() => reopened.get("owner-b", "project-a", first.graph_id)).toThrow("not found");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const recoveryProposal = readFileSync(
  new URL("../../../docs/handoff/INTELLIGENCE_GRAPH_IMPORT_RECOVERY_PROPOSAL.sql", import.meta.url),
  "utf8"
);

describe("durable import receipts", () => {
  const packet = {
    format: "kosmora.intelligence-graph.v1",
    title: "Receipt",
    nodes: [],
    edges: []
  };
  const key = "attempt_0123456789abcdef";
  it("survives reopen, keeps tombstones and fences receipt owners/projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "graph-receipt-")),
      filename = join(dir, "receipts.sqlite");
    let db = new DatabaseSync(filename);
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT); INSERT INTO projects VALUES('project-a','owner-a','ACTIVE'),('project-b','owner-b','ACTIVE')"
      );
      db.exec(proposal);
      db.exec(
        "CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, state TEXT NOT NULL)"
      );
      db.exec(recoveryProposal);
      const service = new IntelligenceGraphWorkspaceService(
        new SqliteIntelligenceGraphWorkspaceRepository(db)
      );
      const preview = service.previewImport(packet);
      const first = service.importPackage("owner-a", "project-a", packet, preview.sha256, key);
      db.close();
      db = new DatabaseSync(filename);
      db.exec("PRAGMA foreign_keys=ON");
      const store = new SqliteIntelligenceGraphWorkspaceRepository(db),
        reopened = new IntelligenceGraphWorkspaceService(store);
      expect(reopened.recoverImport("owner-a", "project-a", key).graph.graph_id).toBe(
        first.graph_id
      );
      expect(
        reopened.importPackage("owner-a", "project-a", packet, preview.sha256, key).graph_id
      ).toBe(first.graph_id);
      expect(store.getImportReceipt("owner-b", "project-a", key)).toBeNull();
      expect(store.getImportReceipt("owner-a", "project-b", key)).toBeNull();
      db.prepare("DELETE FROM intelligence_graph_workspaces WHERE graph_id=?").run(first.graph_id);
      expect(store.getImportReceipt("owner-a", "project-a", key)?.graph_id).toBeNull();
      expect(() => reopened.recoverImport("owner-a", "project-a", key)).toThrow("deleted");
      expect(() =>
        reopened.importPackage("owner-a", "project-a", packet, preview.sha256, key)
      ).toThrow("deleted");
      expect(store.list("owner-a", "project-a", 20)).toEqual([]);
      db.prepare("DELETE FROM projects WHERE id='project-a'").run();
      expect(
        (
          db.prepare("SELECT count(*) AS total FROM intelligence_graph_import_receipts").get() as {
            total: number;
          }
        ).total
      ).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rolls back graph and revision on receipt failure and enforces the receipt quota", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT); INSERT INTO projects VALUES('project-a','owner-a','ACTIVE')"
      );
      db.exec(proposal);
      db.exec(
        "CREATE TABLE kosmora_owner_data_lifecycle(owner_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, state TEXT NOT NULL)"
      );
      db.exec(recoveryProposal);
      const store = new SqliteIntelligenceGraphWorkspaceRepository(db),
        service = new IntelligenceGraphWorkspaceService(store),
        preview = service.previewImport(packet);
      db.exec(
        "CREATE TRIGGER fail_import BEFORE INSERT ON intelligence_graph_import_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END"
      );
      expect(() =>
        service.importPackage("owner-a", "project-a", packet, preview.sha256, key)
      ).toThrow("injected");
      expect(store.list("owner-a", "project-a", 20)).toEqual([]);
      expect(
        (
          db
            .prepare("SELECT count(*) AS total FROM intelligence_graph_workspace_revisions")
            .get() as { total: number }
        ).total
      ).toBe(0);
      db.exec("DROP TRIGGER fail_import");
      const insert = db.prepare(
        "INSERT INTO intelligence_graph_import_receipts VALUES('owner-a','project-a',?,?,NULL,'2026-10-18T00:00:00Z')"
      );
      db.exec("BEGIN");
      for (let i = 0; i < 1000; i++) insert.run("saved_attempt_key_" + i, preview.sha256);
      db.exec("COMMIT");
      expect(() =>
        service.importPackage("owner-a", "project-a", packet, preview.sha256, key)
      ).toThrow("limit");
      expect(store.list("owner-a", "project-a", 20)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
