/**
 * Kosmora Persistent Runtime Store (SQLite WAL + Project-Scoped Point-in-Time Recovery)
 * Uses built-in `node:sqlite` (Node 22.5+/24) with an automatic synchronous Python `sqlite3`
 * bridge fallback on Node 18 so every table, DDL migration, transaction, and project snapshot
 * executes against a real SQLite database engine and survives close/reopen cycles.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

export interface StoredArtifactRevisionRecord {
  revision_id: string;
  artifact_id: string;
  project_id: string;
  tenant_id: string;
  version: number;
  title: string;
  kind: string;
  content_json: string;
  content_sha256: string;
  author_id: string;
  created_at: string;
}

export interface StoredDagPlanRecord {
  plan_id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  goal: string;
  state_json: string;
  status: "running" | "awaiting_hitl" | "completed" | "failed" | "cancelled";
  updated_at: string;
}

export interface StoredKnowledgeNodeRecord {
  node_id: string;
  project_id: string;
  tenant_id: string;
  workspace_id: string;
  title: string;
  content: string;
  version: number;
  stale: number;
  node_json: string;
  updated_at: string;
}

export interface ProjectPointInTimeSnapshot {
  snapshot_id: string;
  project_id: string;
  tenant_id: string;
  created_at: string;
  artifact_revisions_count: number;
  dag_plans_count: number;
  knowledge_nodes_count: number;
  snapshot_sha256: string;
  payload_json: string;
}

export interface SchemaMigrationRecord {
  version: number;
  name: string;
  checksum_sha256: string;
  up_sql: string;
  down_sql: string;
  applied_at: string;
}

interface SqliteStatementLike {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

const PYTHON_SQLITE_DRIVER = `
import json, sqlite3, sys

req = json.loads(sys.stdin.read())
db_path = req["dbPath"]
mode = req["mode"]
sql = req["sql"]
params = req.get("params", [])

conn = sqlite3.connect(db_path, timeout=30.0)
conn.row_factory = sqlite3.Row
try:
    if mode == "exec":
        conn.executescript(sql)
        conn.commit()
        print(json.dumps({"ok": True}))
    elif mode == "run":
        cur = conn.execute(sql, params)
        conn.commit()
        print(json.dumps({"ok": True, "changes": cur.rowcount, "lastInsertRowid": cur.lastrowid}))
    elif mode == "get":
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        conn.commit()
        print(json.dumps({"ok": True, "row": dict(row) if row is not None else None}))
    elif mode == "all":
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.commit()
        print(json.dumps({"ok": True, "rows": rows}))
    else:
        raise ValueError("Unsupported mode: " + str(mode))
except Exception as exc:
    conn.rollback()
    print(json.dumps({"ok": False, "error": str(exc)}))
    sys.exit(1)
finally:
    conn.close()
`;

class PythonSqliteFallbackDatabase implements SqliteDatabaseLike {
  private closed = false;

  constructor(private readonly filePath: string) {}

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("SQLite database connection is closed");
    }
  }

  private invoke(
    mode: "exec" | "run" | "get" | "all",
    sql: string,
    params: unknown[] = []
  ): Record<string, unknown> {
    this.ensureOpen();
    const normalizedParams = params.map((p) => (p === undefined ? null : p));
    const proc = spawnSync("python3", ["-c", PYTHON_SQLITE_DRIVER], {
      input: JSON.stringify({
        dbPath: this.filePath,
        mode,
        sql,
        params: normalizedParams
      }),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });

    if (proc.status !== 0) {
      let errMessage = proc.stderr || proc.stdout || "SQLite execution failed";
      try {
        const parsed = JSON.parse(proc.stdout) as { error?: string };
        if (parsed.error) errMessage = parsed.error;
      } catch {
        // use raw stderr/stdout
      }
      throw new Error(`SQLite error: ${errMessage.trim()}`);
    }

    return JSON.parse(proc.stdout) as Record<string, unknown>;
  }

  public exec(sql: string): void {
    this.invoke("exec", sql);
  }

  public prepare(sql: string): SqliteStatementLike {
    return {
      run: (...params: unknown[]) => this.invoke("run", sql, params),
      get: (...params: unknown[]) => this.invoke("get", sql, params).row ?? undefined,
      all: (...params: unknown[]) => (this.invoke("all", sql, params).rows as unknown[]) ?? []
    };
  }

  public close(): void {
    this.closed = true;
  }
}

function openSqliteDatabase(resolvedPath: string): SqliteDatabaseLike {
  try {
    const req = createRequire(import.meta.url);
    const sqliteMod = req("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabaseLike;
    };
    if (sqliteMod && typeof sqliteMod.DatabaseSync === "function") {
      return new sqliteMod.DatabaseSync(resolvedPath);
    }
  } catch {
    // Fallback to Python sqlite3 bridge on Node < 22.5
  }
  return new PythonSqliteFallbackDatabase(resolvedPath);
}

const BASE_MIGRATIONS: Array<{
  version: number;
  name: string;
  upSql: string;
  downSql: string;
}> = [
  {
    version: 1,
    name: "001_initial_kosmora_runtime_tables",
    upSql: `
      CREATE TABLE IF NOT EXISTS kosmora_artifact_revisions (
        revision_id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'proj_default',
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_artifact_proj_ver
        ON kosmora_artifact_revisions(project_id, artifact_id, version DESC);

      CREATE TABLE IF NOT EXISTS kosmora_dag_plans (
        plan_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'ws_default',
        goal TEXT NOT NULL,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_dag_project
        ON kosmora_dag_plans(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS kosmora_project_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        created_at TEXT NOT NULL,
        artifact_revisions_count INTEGER NOT NULL,
        dag_plans_count INTEGER NOT NULL,
        knowledge_nodes_count INTEGER NOT NULL DEFAULT 0,
        snapshot_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `,
    downSql: `
      DROP TABLE IF EXISTS kosmora_project_snapshots;
      DROP TABLE IF EXISTS kosmora_dag_plans;
      DROP TABLE IF EXISTS kosmora_artifact_revisions;
    `
  },
  {
    version: 2,
    name: "002_knowledge_nodes_and_audit_persistence",
    upSql: `
      CREATE TABLE IF NOT EXISTS kosmora_knowledge_nodes (
        node_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
        workspace_id TEXT NOT NULL DEFAULT 'ws_default',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        stale INTEGER NOT NULL DEFAULT 0,
        node_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_kosmora_nodes_project
        ON kosmora_knowledge_nodes(project_id, stale);
    `,
    downSql: `
      DROP TABLE IF EXISTS kosmora_knowledge_nodes;
    `
  }
];

export class KosmoraRuntimeStore {
  private db: SqliteDatabaseLike;
  private readonly physicalPath: string;
  private readonly isEphemeralMemoryFile: boolean;
  private isClosed = false;

  constructor(dbPath = ":memory:") {
    if (dbPath === ":memory:") {
      const tempDir = resolve(tmpdir(), "kosmora-sqlite-mem");
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }
      this.physicalPath = resolve(tempDir, `kosmora_${randomUUID()}.db`);
      this.isEphemeralMemoryFile = true;
    } else {
      this.physicalPath = resolve(dbPath);
      const parentDir = dirname(this.physicalPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      this.isEphemeralMemoryFile = false;
    }

    this.db = openSqliteDatabase(this.physicalPath);
    this.initializeSchema();
  }

  public getDatabasePath(): string {
    return this.physicalPath;
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS kosmora_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        up_sql TEXT NOT NULL,
        down_sql TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    for (const mig of BASE_MIGRATIONS) {
      this.applyMigration(mig.version, mig.name, mig.upSql, mig.downSql);
    }
  }

  /**
   * F139: Real DDL schema migration execution with checksum verification & rollback support.
   */
  public applyMigration(
    version: number,
    name: string,
    upSql: string,
    downSql = ""
  ): SchemaMigrationRecord {
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error("Migration version must be a positive integer");
    }
    const checksum = createHash("sha256").update(upSql.trim()).digest("hex");
    const existing = this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations WHERE version = ?`
      )
      .get(version) as SchemaMigrationRecord | undefined;

    if (existing) {
      if (existing.checksum_sha256 !== checksum) {
        throw new Error(
          `Migration v${version} ('${name}') checksum mismatch: expected ${existing.checksum_sha256}, got ${checksum}`
        );
      }
      return existing;
    }

    this.db.exec(upSql);
    const appliedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO kosmora_schema_migrations (version, name, checksum_sha256, up_sql, down_sql, applied_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(version, name, checksum, upSql, downSql, appliedAt);

    return {
      version,
      name,
      checksum_sha256: checksum,
      up_sql: upSql,
      down_sql: downSql,
      applied_at: appliedAt
    };
  }

  public rollbackMigration(version: number): boolean {
    const existing = this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations WHERE version = ?`
      )
      .get(version) as SchemaMigrationRecord | undefined;

    if (!existing) {
      return false;
    }
    if (!existing.down_sql || existing.down_sql.trim().length === 0) {
      throw new Error(`Migration v${version} ('${existing.name}') has no down_sql for rollback`);
    }

    this.db.exec(existing.down_sql);
    this.db
      .prepare(`DELETE FROM kosmora_schema_migrations WHERE version = ?`)
      .run(version);
    return true;
  }

  public listAppliedMigrations(): SchemaMigrationRecord[] {
    return this.db
      .prepare(
        `SELECT version, name, checksum_sha256, up_sql, down_sql, applied_at
         FROM kosmora_schema_migrations ORDER BY version ASC`
      )
      .all() as SchemaMigrationRecord[];
  }

  public inspectTableColumns(tableName: string): Array<{ name: string; type: string; notnull: number }> {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid SQLite table identifier: ${tableName}`);
    }
    return this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
  }

  public saveArtifactRevision(
    record: Omit<StoredArtifactRevisionRecord, "project_id" | "tenant_id"> & {
      project_id?: string;
      tenant_id?: string;
    }
  ): void {
    const projectId = record.project_id ?? "proj_default";
    const tenantId = record.tenant_id ?? "tenant_default";
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_artifact_revisions (
        revision_id, artifact_id, project_id, tenant_id, version, title, kind,
        content_json, content_sha256, author_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.revision_id,
      record.artifact_id,
      projectId,
      tenantId,
      record.version,
      record.title,
      record.kind,
      record.content_json,
      record.content_sha256,
      record.author_id,
      record.created_at
    );
  }

  public listArtifactRevisions(
    artifactId: string,
    projectId?: string
  ): StoredArtifactRevisionRecord[] {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
               content_json, content_sha256, author_id, created_at
        FROM kosmora_artifact_revisions
        WHERE artifact_id = ? AND project_id = ?
        ORDER BY version ASC
      `);
      return stmt.all(artifactId, projectId) as unknown as StoredArtifactRevisionRecord[];
    }
    const stmt = this.db.prepare(`
      SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
             content_json, content_sha256, author_id, created_at
      FROM kosmora_artifact_revisions
      WHERE artifact_id = ?
      ORDER BY version ASC
    `);
    return stmt.all(artifactId) as unknown as StoredArtifactRevisionRecord[];
  }

  public saveDagPlan(
    record: Omit<StoredDagPlanRecord, "workspace_id"> & { workspace_id?: string }
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_dag_plans (
        plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.plan_id,
      record.project_id,
      record.tenant_id,
      record.workspace_id ?? "ws_default",
      record.goal,
      record.state_json,
      record.status,
      record.updated_at
    );
  }

  public getDagPlan(planId: string, projectId?: string): StoredDagPlanRecord | undefined {
    if (projectId) {
      const stmt = this.db.prepare(`
        SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
        FROM kosmora_dag_plans
        WHERE plan_id = ? AND project_id = ?
      `);
      return stmt.get(planId, projectId) as StoredDagPlanRecord | undefined;
    }
    const stmt = this.db.prepare(`
      SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
      FROM kosmora_dag_plans
      WHERE plan_id = ?
    `);
    return stmt.get(planId) as StoredDagPlanRecord | undefined;
  }

  public saveKnowledgeNode(record: StoredKnowledgeNodeRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO kosmora_knowledge_nodes (
        node_id, project_id, tenant_id, workspace_id, title, content, version, stale, node_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.node_id,
      record.project_id,
      record.tenant_id,
      record.workspace_id,
      record.title,
      record.content,
      record.version,
      record.stale ? 1 : 0,
      record.node_json,
      record.updated_at
    );
  }

  public listKnowledgeNodes(projectId: string): StoredKnowledgeNodeRecord[] {
    const stmt = this.db.prepare(`
      SELECT node_id, project_id, tenant_id, workspace_id, title, content, version, stale, node_json, updated_at
      FROM kosmora_knowledge_nodes
      WHERE project_id = ?
      ORDER BY node_id ASC
    `);
    return stmt.all(projectId) as unknown as StoredKnowledgeNodeRecord[];
  }

  /**
   * F142: Strictly project-scoped Point-in-Time Snapshot Creation & Restoration.
   * Captures ONLY artifacts, DAG plans, and knowledge nodes belonging to `projectId`.
   */
  public createProjectSnapshot(
    projectId: string,
    tenantId = "tenant_default"
  ): ProjectPointInTimeSnapshot {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("createProjectSnapshot requires a non-empty projectId");
    }

    const artifacts = this.db
      .prepare(
        `SELECT revision_id, artifact_id, project_id, tenant_id, version, title, kind,
                content_json, content_sha256, author_id, created_at
         FROM kosmora_artifact_revisions
         WHERE project_id = ?
         ORDER BY revision_id ASC`
      )
      .all(projectId) as unknown as StoredArtifactRevisionRecord[];

    const plans = this.db
      .prepare(
        `SELECT plan_id, project_id, tenant_id, workspace_id, goal, state_json, status, updated_at
         FROM kosmora_dag_plans
         WHERE project_id = ?
         ORDER BY plan_id ASC`
      )
      .all(projectId) as unknown as StoredDagPlanRecord[];

    const nodes = this.listKnowledgeNodes(projectId);

    const payloadJson = JSON.stringify({
      project_id: projectId,
      tenant_id: tenantId,
      artifacts,
      plans,
      nodes
    });
    const snapshotSha256 = createHash("sha256").update(payloadJson).digest("hex");

    const snapshot: ProjectPointInTimeSnapshot = {
      snapshot_id: `snap_${projectId}_${Date.now()}_${snapshotSha256.slice(0, 8)}`,
      project_id: projectId,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      artifact_revisions_count: artifacts.length,
      dag_plans_count: plans.length,
      knowledge_nodes_count: nodes.length,
      snapshot_sha256: snapshotSha256,
      payload_json: payloadJson
    };

    const stmt = this.db.prepare(`
      INSERT INTO kosmora_project_snapshots (
        snapshot_id, project_id, tenant_id, created_at,
        artifact_revisions_count, dag_plans_count, knowledge_nodes_count,
        snapshot_sha256, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.snapshot_id,
      snapshot.project_id,
      snapshot.tenant_id,
      snapshot.created_at,
      snapshot.artifact_revisions_count,
      snapshot.dag_plans_count,
      snapshot.knowledge_nodes_count,
      snapshot.snapshot_sha256,
      snapshot.payload_json
    );

    return snapshot;
  }

  /**
   * Restores a point-in-time snapshot ONLY for its owning project_id without touching other projects.
   */
  public restoreProjectSnapshot(snapshotId: string): {
    project_id: string;
    restored_artifacts: number;
    restored_plans: number;
    restored_nodes: number;
  } {
    const stmt = this.db.prepare(`
      SELECT snapshot_id, project_id, tenant_id, created_at,
             artifact_revisions_count, dag_plans_count, knowledge_nodes_count,
             snapshot_sha256, payload_json
      FROM kosmora_project_snapshots
      WHERE snapshot_id = ?
    `);
    const snap = stmt.get(snapshotId) as ProjectPointInTimeSnapshot | undefined;
    if (!snap) {
      throw new Error(`Snapshot '${snapshotId}' not found`);
    }

    const recomputedHash = createHash("sha256").update(snap.payload_json).digest("hex");
    if (recomputedHash !== snap.snapshot_sha256) {
      throw new Error(`Snapshot '${snapshotId}' integrity check failed (SHA-256 mismatch)`);
    }

    const parsed = JSON.parse(snap.payload_json) as {
      project_id: string;
      artifacts: StoredArtifactRevisionRecord[];
      plans: StoredDagPlanRecord[];
      nodes?: StoredKnowledgeNodeRecord[];
    };

    const targetProjectId = snap.project_id;

    // Clear current records of ONLY this project before restoring snapshot state
    this.db
      .prepare(`DELETE FROM kosmora_artifact_revisions WHERE project_id = ?`)
      .run(targetProjectId);
    this.db
      .prepare(`DELETE FROM kosmora_dag_plans WHERE project_id = ?`)
      .run(targetProjectId);
    this.db
      .prepare(`DELETE FROM kosmora_knowledge_nodes WHERE project_id = ?`)
      .run(targetProjectId);

    for (const art of parsed.artifacts) {
      if (art.project_id === targetProjectId) {
        this.saveArtifactRevision(art);
      }
    }
    for (const plan of parsed.plans) {
      if (plan.project_id === targetProjectId) {
        this.saveDagPlan(plan);
      }
    }
    for (const node of parsed.nodes ?? []) {
      if (node.project_id === targetProjectId) {
        this.saveKnowledgeNode(node);
      }
    }

    return {
      project_id: targetProjectId,
      restored_artifacts: parsed.artifacts.length,
      restored_plans: parsed.plans.length,
      restored_nodes: (parsed.nodes ?? []).length
    };
  }

  /**
   * F141: Project-Scoped Storage Quota & Retention Policy Enforcement
   */
  public evaluateProjectStorageQuota(
    projectId: string,
    maxBytesQuota = 50 * 1024 * 1024
  ): {
    project_id: string;
    used_bytes: number;
    max_bytes: number;
    utilization_pct: number;
    within_quota: boolean;
  } {
    if (!projectId || projectId.trim().length === 0) {
      throw new Error("evaluateProjectStorageQuota requires a non-empty projectId");
    }

    const artRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(content_json)), 0) as bytes
         FROM kosmora_artifact_revisions
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const dagRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(state_json)), 0) as bytes
         FROM kosmora_dag_plans
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const nodeRow = this.db
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(node_json)), 0) as bytes
         FROM kosmora_knowledge_nodes
         WHERE project_id = ?`
      )
      .get(projectId) as { bytes: number };

    const usedBytes = Number(artRow.bytes ?? 0) + Number(dagRow.bytes ?? 0) + Number(nodeRow.bytes ?? 0);
    const utilizationPct = Number(((usedBytes / Math.max(1, maxBytesQuota)) * 100).toFixed(4));

    return {
      project_id: projectId,
      used_bytes: usedBytes,
      max_bytes: maxBytesQuota,
      utilization_pct: utilizationPct,
      within_quota: usedBytes <= maxBytesQuota
    };
  }

  public close(cleanupEphemeral = false): void {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
    if (cleanupEphemeral && this.isEphemeralMemoryFile && existsSync(this.physicalPath)) {
      rmSync(this.physicalPath, { force: true });
    }
  }

  public reopen(): void {
    if (this.isClosed) {
      this.db = openSqliteDatabase(this.physicalPath);
      this.isClosed = false;
    }
  }
}
