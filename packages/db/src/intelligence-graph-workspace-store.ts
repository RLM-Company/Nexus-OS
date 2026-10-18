import type { DatabaseSync } from "node:sqlite";
import type {
  IntelligenceGraphRevisionInfo,
  IntelligenceGraphImportReceipt,
  IntelligenceGraphImportResult,
  IntelligenceGraphWorkspace,
  IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";

/**
 * SQLite adapter. Tables are owned by a managed migration, never created by
 * runtime code. Do not instantiate until the migration is installed.
 * All reads/writes are fenced by BOTH owner and project.
 */
export class SqliteIntelligenceGraphWorkspaceRepository implements IntelligenceGraphWorkspaceRepository {
  constructor(private readonly sqlite: DatabaseSync) {}

  private projectExists(ownerId: string, projectId: string): boolean {
    return Boolean(
      this.sqlite
        .prepare("SELECT 1 FROM projects WHERE id = ? AND owner_id = ? AND status = 'ACTIVE'")
        .get(projectId, ownerId)
    );
  }

  private inTransaction<T>(work: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.sqlite.exec("COMMIT");
      return value;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  create(record: IntelligenceGraphWorkspace): IntelligenceGraphWorkspace | null {
    return this.inTransaction(() => {
      if (!this.projectExists(record.owner_id, record.project_id)) return null;
      this.insert(record);
      return structuredClone(record);
    });
  }

  private insert(record: IntelligenceGraphWorkspace): void {
    this.sqlite
      .prepare(
        `INSERT INTO intelligence_graph_workspaces
            (graph_id, owner_id, project_id, title, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.graph_id,
        record.owner_id,
        record.project_id,
        record.title,
        record.revision,
        record.created_at,
        record.updated_at
      );
    this.sqlite
      .prepare(
        `INSERT INTO intelligence_graph_workspace_revisions
            (graph_id, revision, snapshot_json, summary, restored_from_revision, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`
      )
      .run(
        record.graph_id,
        record.revision,
        JSON.stringify(record),
        "Graph created",
        record.created_at
      );
  }

  getImportReceipt(
    ownerId: string,
    projectId: string,
    creationKey: string
  ): IntelligenceGraphImportReceipt | null {
    if (!this.projectExists(ownerId, projectId)) return null;
    return (
      (this.sqlite
        .prepare(
          `SELECT creation_key, package_sha256, graph_id FROM intelligence_graph_import_receipts
      WHERE owner_id=? AND project_id=? AND creation_key=?`
        )
        .get(ownerId, projectId, creationKey) as IntelligenceGraphImportReceipt | undefined) ?? null
    );
  }

  createImported(
    record: IntelligenceGraphWorkspace,
    creationKey: string,
    packageSha256: string
  ): IntelligenceGraphImportResult | null {
    return this.inTransaction(() => {
      if (!this.projectExists(record.owner_id, record.project_id)) return null;
      const receipt = this.getImportReceipt(record.owner_id, record.project_id, creationKey);
      if (receipt) {
        if (receipt.package_sha256 !== packageSha256) return { kind: "conflict" };
        const existing = receipt.graph_id
          ? this.get(record.owner_id, record.project_id, receipt.graph_id)
          : null;
        return existing ? { kind: "replayed", graph: existing } : { kind: "deleted" };
      }
      const count = this.sqlite
        .prepare(
          "SELECT count(*) AS total FROM intelligence_graph_import_receipts WHERE owner_id=? AND project_id=?"
        )
        .get(record.owner_id, record.project_id) as { total: number };
      if (count.total >= 1000) return { kind: "limit" };
      this.insert(record);
      this.sqlite
        .prepare(
          `INSERT INTO intelligence_graph_import_receipts(owner_id,project_id,creation_key,package_sha256,graph_id,created_at)
        VALUES(?,?,?,?,?,?)`
        )
        .run(
          record.owner_id,
          record.project_id,
          creationKey,
          packageSha256,
          record.graph_id,
          record.created_at
        );
      return { kind: "created", graph: structuredClone(record) };
    });
  }

  get(ownerId: string, projectId: string, graphId: string): IntelligenceGraphWorkspace | null {
    const row = this.sqlite
      .prepare(
        `SELECT r.snapshot_json FROM intelligence_graph_workspaces g
         JOIN projects p ON p.id = g.project_id AND p.owner_id = g.owner_id
         JOIN intelligence_graph_workspace_revisions r
           ON r.graph_id = g.graph_id AND r.revision = g.revision
         WHERE g.graph_id = ? AND g.owner_id = ? AND g.project_id = ?`
      )
      .get(graphId, ownerId, projectId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as IntelligenceGraphWorkspace) : null;
  }

  list(ownerId: string, projectId: string, limit: number): IntelligenceGraphWorkspace[] {
    const rows = this.sqlite
      .prepare(
        `SELECT r.snapshot_json FROM intelligence_graph_workspaces g
         JOIN projects p ON p.id = g.project_id AND p.owner_id = g.owner_id
         JOIN intelligence_graph_workspace_revisions r
           ON r.graph_id = g.graph_id AND r.revision = g.revision
         WHERE g.owner_id = ? AND g.project_id = ?
         ORDER BY g.updated_at DESC, g.graph_id DESC LIMIT ?`
      )
      .all(ownerId, projectId, limit) as { snapshot_json: string }[];
    return rows.map((row) => JSON.parse(row.snapshot_json) as IntelligenceGraphWorkspace);
  }

  getRevision(
    ownerId: string,
    projectId: string,
    graphId: string,
    revision: number
  ): IntelligenceGraphWorkspace | null {
    const row = this.sqlite
      .prepare(
        `SELECT r.snapshot_json FROM intelligence_graph_workspaces g
         JOIN projects p ON p.id = g.project_id AND p.owner_id = g.owner_id
         JOIN intelligence_graph_workspace_revisions r ON r.graph_id = g.graph_id
         WHERE g.graph_id = ? AND g.owner_id = ? AND g.project_id = ? AND r.revision = ?`
      )
      .get(graphId, ownerId, projectId, revision) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as IntelligenceGraphWorkspace) : null;
  }

  listRevisions(
    ownerId: string,
    projectId: string,
    graphId: string,
    limit: number
  ): IntelligenceGraphRevisionInfo[] {
    return this.sqlite
      .prepare(
        `SELECT r.revision, r.created_at, r.summary, r.restored_from_revision
         FROM intelligence_graph_workspaces g
         JOIN projects p ON p.id = g.project_id AND p.owner_id = g.owner_id
         JOIN intelligence_graph_workspace_revisions r ON r.graph_id = g.graph_id
         WHERE g.graph_id = ? AND g.owner_id = ? AND g.project_id = ?
         ORDER BY r.revision DESC LIMIT ?`
      )
      .all(graphId, ownerId, projectId, limit) as unknown as IntelligenceGraphRevisionInfo[];
  }

  save(
    record: IntelligenceGraphWorkspace,
    expectedRevision: number,
    summary: string
  ): IntelligenceGraphWorkspace | null {
    return this.inTransaction(() => {
      const changed = this.sqlite
        .prepare(
          `UPDATE intelligence_graph_workspaces AS g
           SET revision = ?, title = ?, updated_at = ?
           WHERE g.graph_id = ? AND g.owner_id = ? AND g.project_id = ? AND g.revision = ?
             AND EXISTS (SELECT 1 FROM projects p
                         WHERE p.id = g.project_id AND p.owner_id = g.owner_id
                           AND p.status = 'ACTIVE')`
        )
        .run(
          record.revision,
          record.title,
          record.updated_at,
          record.graph_id,
          record.owner_id,
          record.project_id,
          expectedRevision
        );
      if (Number(changed.changes) !== 1) return null;
      this.sqlite
        .prepare(
          `INSERT INTO intelligence_graph_workspace_revisions
            (graph_id, revision, snapshot_json, summary, restored_from_revision, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.graph_id,
          record.revision,
          JSON.stringify(record),
          summary,
          record.restored_from_revision,
          record.updated_at
        );
      return structuredClone(record);
    });
  }
}
