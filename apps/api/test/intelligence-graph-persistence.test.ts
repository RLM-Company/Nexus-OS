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
