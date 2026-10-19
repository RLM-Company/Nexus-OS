import type { DatabaseSync } from "node:sqlite";
import {
  validateIntelligenceGraphSnapshot,
  validateIntelligenceGraphWorkspaceConflicts,
  validateIntelligenceGraphWorkspaceVersionState
} from "@cosmora/contracts";
import type {
  IntelligenceGraphRevisionInfo,
  IntelligenceGraphSummary,
  IntelligenceGraphLibraryQuery,
  IntelligenceGraphImportReceipt,
  IntelligenceGraphImportResult,
  IntelligenceGraphWorkspace,
  IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";

export class IntelligenceGraphPrivacyError extends Error {
  constructor(
    readonly code:
      | "GRAPH_OWNER_FENCED"
      | "GRAPH_PRIVACY_UNAVAILABLE"
      | "GRAPH_PRIVACY_FENCE_MISMATCH"
      | "GRAPH_PRIVACY_EXPORT_LIMIT"
      | "GRAPH_PRIVACY_INCONSISTENT",
    message: string = code
  ) {
    super(message);
    this.name = "IntelligenceGraphPrivacyError";
  }
}
export interface IntelligenceGraphPrivacySnapshot {
  records: Record<string, unknown[]>;
  originals: [];
  complete: true;
}

/**
 * SQLite adapter. Tables are owned by a managed migration, never created by
 * runtime code. Do not instantiate until the migration is installed.
 * All reads/writes are fenced by BOTH owner and project.
 */
export class SqliteIntelligenceGraphWorkspaceRepository implements IntelligenceGraphWorkspaceRepository {
  constructor(private readonly sqlite: DatabaseSync) {
    this.sqlite.function("kosmora_graph_title_fold", { deterministic: true }, (value) =>
      typeof value === "string" ? value.normalize("NFC").toLocaleLowerCase("ru-RU") : ""
    );
  }

  private lifecycle(owner: string): { state: string; epoch: number } {
    if (
      !this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='kosmora_owner_data_lifecycle'"
        )
        .get()
    ) {
      throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_UNAVAILABLE");
    }
    const row = this.sqlite
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(owner) as { state: string; epoch: number } | undefined;
    if (!row) return { state: "active", epoch: 0 };
    if (
      !Number.isSafeInteger(row.epoch) ||
      row.epoch < 0 ||
      !["active", "quiescing", "deleting", "deleted", "error"].includes(row.state)
    )
      throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_UNAVAILABLE");
    return row;
  }

  private assertWritable(owner: string): void {
    if (this.lifecycle(owner).state !== "active")
      throw new IntelligenceGraphPrivacyError("GRAPH_OWNER_FENCED");
  }

  private assertFence(owner: string, epoch: number, state: "quiescing" | "deleting"): void {
    const row = this.lifecycle(owner);
    if (!Number.isSafeInteger(epoch) || epoch < 1 || row.epoch !== epoch || row.state !== state)
      throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_FENCE_MISMATCH");
  }

  privacyQuiesce(owner: string, epoch: number): { drained: true; fence_epoch: number } {
    return this.inTransaction(() => {
      this.assertFence(owner, epoch, "quiescing");
      // Acquiring the SQLite writer lock drains synchronous writes from other connections too.
      return { drained: true, fence_epoch: epoch };
    });
  }

  privacyExport(
    owner: string,
    epoch: number,
    options: { maxRecords?: number; maxBytes?: number } = {}
  ): IntelligenceGraphPrivacySnapshot {
    const maxRecords = options.maxRecords ?? 10000,
      maxBytes = options.maxBytes ?? 12 * 1024 * 1024;
    if (
      !Number.isSafeInteger(maxRecords) ||
      maxRecords < 1 ||
      maxRecords > 100000 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 64 * 1024 * 1024
    )
      throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_EXPORT_LIMIT");
    return this.inTransaction(() => {
      this.assertFence(owner, epoch, "quiescing");
      // All three sections are mandatory, including archived projects and receipt tombstones.
      const totals = this.privacyCounts(owner);
      const raw = this.sqlite
        .prepare(
          `SELECT COALESCE(sum(length(CAST(r.snapshot_json AS BLOB))),0) AS bytes
        FROM intelligence_graph_workspace_revisions r JOIN intelligence_graph_workspaces g ON g.graph_id=r.graph_id WHERE g.owner_id=?`
        )
        .get(owner) as { bytes: number };
      if (totals.graphs + totals.revisions + totals.receipts > maxRecords || raw.bytes > maxBytes)
        throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_EXPORT_LIMIT");
      const workspaces: unknown[] = [],
        revisions: unknown[] = [],
        receipts: unknown[] = [];
      let bytes = 0;
      const append = (target: unknown[], row: unknown) => {
        bytes += Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
        if (bytes > maxBytes) throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_EXPORT_LIMIT");
        target.push(row);
      };
      const graphIds = new Map<string, { project_id: string; revision: number }>();
      for (const row of this.sqlite
        .prepare(
          "SELECT graph_id,owner_id,project_id,title,revision,created_at,updated_at FROM intelligence_graph_workspaces WHERE owner_id=? ORDER BY graph_id"
        )
        .iterate(owner)) {
        graphIds.set(row.graph_id as string, {
          project_id: row.project_id as string,
          revision: row.revision as number
        });
        append(workspaces, row);
      }
      const currentSeen = new Set<string>();
      for (const row of this.sqlite
        .prepare(
          `SELECT r.graph_id,r.revision,r.snapshot_json,r.summary,r.restored_from_revision,r.created_at
        FROM intelligence_graph_workspace_revisions r JOIN intelligence_graph_workspaces g ON g.graph_id=r.graph_id WHERE g.owner_id=? ORDER BY r.graph_id,r.revision`
        )
        .iterate(owner)) {
        const snapshot: unknown = JSON.parse(row.snapshot_json as string);
        const meta = graphIds.get(row.graph_id as string);
        if (
          !meta ||
          !snapshot ||
          typeof snapshot !== "object" ||
          !("owner_id" in snapshot) ||
          snapshot.owner_id !== owner ||
          !("project_id" in snapshot) ||
          snapshot.project_id !== meta.project_id ||
          !("graph_id" in snapshot) ||
          snapshot.graph_id !== row.graph_id ||
          !("revision" in snapshot) ||
          snapshot.revision !== row.revision
        )
          throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_INCONSISTENT");
        if (row.revision === meta.revision) currentSeen.add(row.graph_id as string);
        const workspace = snapshot as IntelligenceGraphWorkspace;
        if (
          !Array.isArray(workspace.nodes) ||
          !Array.isArray(workspace.edges) ||
          !Array.isArray(workspace.records) ||
          validateIntelligenceGraphSnapshot({
            ownerId: owner,
            projectId: meta.project_id,
            nodes: workspace.nodes,
            edges: workspace.edges
          }).length ||
          validateIntelligenceGraphWorkspaceConflicts(workspace).length ||
          validateIntelligenceGraphWorkspaceVersionState(workspace).length
        )
          throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_INCONSISTENT");
        append(revisions, {
          graph_id: row.graph_id,
          revision: row.revision,
          snapshot,
          summary: row.summary,
          restored_from_revision: row.restored_from_revision,
          created_at: row.created_at
        });
      }
      if (currentSeen.size !== graphIds.size)
        throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_INCONSISTENT");
      for (const row of this.sqlite
        .prepare(
          "SELECT owner_id,project_id,creation_key,package_sha256,graph_id,created_at FROM intelligence_graph_import_receipts WHERE owner_id=? ORDER BY project_id,creation_key"
        )
        .iterate(owner)) {
        if (
          row.graph_id !== null &&
          graphIds.get(row.graph_id as string)?.project_id !== row.project_id
        )
          throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_INCONSISTENT");
        append(receipts, row);
      }
      const result: IntelligenceGraphPrivacySnapshot = {
        records: {
          intelligence_graph_workspaces: workspaces,
          intelligence_graph_revisions: revisions,
          intelligence_graph_import_receipts: receipts
        },
        originals: [],
        complete: true
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes)
        throw new IntelligenceGraphPrivacyError("GRAPH_PRIVACY_EXPORT_LIMIT");
      this.assertFence(owner, epoch, "quiescing");
      return result;
    });
  }

  private privacyCounts(owner: string): { graphs: number; revisions: number; receipts: number } {
    const count = (sql: string) => (this.sqlite.prepare(sql).get(owner) as { total: number }).total;
    return {
      graphs: count("SELECT count(*) AS total FROM intelligence_graph_workspaces WHERE owner_id=?"),
      revisions: count(
        "SELECT count(*) AS total FROM intelligence_graph_workspace_revisions r JOIN intelligence_graph_workspaces g ON g.graph_id=r.graph_id WHERE g.owner_id=?"
      ),
      receipts: count(
        "SELECT count(*) AS total FROM intelligence_graph_import_receipts WHERE owner_id=?"
      )
    };
  }

  privacyDelete(owner: string, epoch: number): { deleted_records: number } {
    return this.inTransaction(() => {
      this.assertFence(owner, epoch, "deleting");
      const counts = this.privacyCounts(owner);
      this.sqlite
        .prepare("DELETE FROM intelligence_graph_import_receipts WHERE owner_id=?")
        .run(owner);
      this.sqlite.prepare("DELETE FROM intelligence_graph_workspaces WHERE owner_id=?").run(owner);
      this.assertFence(owner, epoch, "deleting");
      return { deleted_records: counts.graphs + counts.revisions + counts.receipts };
    });
  }

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
      this.assertWritable(record.owner_id);
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
      this.assertWritable(record.owner_id);
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

  listPage(
    ownerId: string,
    projectId: string,
    query: IntelligenceGraphLibraryQuery
  ): { items: IntelligenceGraphSummary[]; has_more: boolean } {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 20 ||
      typeof query.query !== "string" ||
      query.query.length > 120
    )
      throw new RangeError("Invalid graph library page bounds");
    const search = query.query.normalize("NFC").toLocaleLowerCase("ru-RU"),
      before = query.before;
    const rows = this.sqlite
      .prepare(
        `SELECT g.graph_id,g.title,g.revision,g.created_at,g.updated_at
      FROM intelligence_graph_workspaces g JOIN projects p ON p.id=g.project_id AND p.owner_id=g.owner_id
      WHERE g.owner_id=? AND g.project_id=? AND (?='' OR instr(kosmora_graph_title_fold(g.title),?)>0)
      AND (? IS NULL OR g.updated_at<? OR (g.updated_at=? AND g.graph_id<?))
      ORDER BY g.updated_at DESC,g.graph_id DESC LIMIT ?`
      )
      .all(
        ownerId,
        projectId,
        search,
        search,
        before?.updated_at ?? null,
        before?.updated_at ?? null,
        before?.updated_at ?? null,
        before?.graph_id ?? null,
        query.limit + 1
      ) as unknown as IntelligenceGraphSummary[];
    return { items: rows.slice(0, query.limit), has_more: rows.length > query.limit };
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
      this.assertWritable(record.owner_id);
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
