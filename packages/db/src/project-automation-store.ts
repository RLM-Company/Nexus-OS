import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AutomationKind =
  | "playbook"
  | "playbook_version"
  | "instantiation"
  | "schedule"
  | "occurrence"
  | "suite"
  | "evaluation"
  | "collection"
  | "binding";
export type AutomationScope = { owner: string; project: string };
export type AutomationRecord<T = Record<string, unknown>> = {
  id: string;
  project_id: string;
  kind: AutomationKind;
  version: number;
  body: T;
  created_at: string;
  updated_at: string;
};
type Row = Omit<AutomationRecord, "body"> & {
  owner_id: string;
  body_json: string;
  fingerprint: string;
};
export class AutomationStoreError extends Error {}
/** Compose synchronous native-SQLite operations without committing a caller's transaction. */
export function automationTransaction<T>(sql: DatabaseSync, fn: () => T): T {
  const nested = sql.isTransaction;
  const savepoint = "automation_" + randomUUID().replaceAll("-", "");
  sql.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = fn();
    sql.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    sql.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    throw error;
  }
}
export class ProjectAutomationStore {
  constructor(
    readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}
  transaction<T>(fn: () => T): T {
    return automationTransaction(this.sql, fn);
  }
  assertWritable(scope: AutomationScope): void {
    if (
      !this.sql
        .prepare("SELECT 1 FROM projects WHERE id=? AND owner_id=? AND status='ACTIVE'")
        .get(scope.project, scope.owner)
    )
      throw new AutomationStoreError("PROJECT_INACTIVE");
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(scope.owner) ||
      this.sql
        .prepare("SELECT 1 FROM work_owner_fences WHERE owner_id=? AND fenced=1")
        .get(scope.owner)
    )
      throw new AutomationStoreError("OWNER_DATA_FENCED");
  }
  private view<T>(row: Row): AutomationRecord<T> {
    return {
      id: row.id,
      project_id: row.project_id,
      kind: row.kind,
      version: row.version,
      body: JSON.parse(row.body_json) as T,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
  get<T>(scope: AutomationScope, kind: AutomationKind, id: string): AutomationRecord<T> | null {
    const row = this.sql
      .prepare(
        `SELECT r.* FROM kosmora_automation_records r JOIN projects p ON p.id=r.project_id
      WHERE r.owner_id=? AND p.owner_id=? AND r.project_id=? AND r.kind=? AND r.id=?`
      )
      .get(scope.owner, scope.owner, scope.project, kind, id) as Row | undefined;
    return row ? this.view<T>(row) : null;
  }
  byKey<T>(scope: AutomationScope, kind: AutomationKind, key: string): AutomationRecord<T> | null {
    const row = this.sql
      .prepare(
        `SELECT r.* FROM kosmora_automation_records r JOIN projects p ON p.id=r.project_id
      WHERE r.owner_id=? AND p.owner_id=? AND r.project_id=? AND r.kind=? AND r.client_key=?`
      )
      .get(scope.owner, scope.owner, scope.project, kind, key) as Row | undefined;
    return row ? this.view<T>(row) : null;
  }
  list<T>(scope: AutomationScope, kind: AutomationKind): AutomationRecord<T>[] {
    return (
      this.sql
        .prepare(
          `SELECT r.* FROM kosmora_automation_records r JOIN projects p ON p.id=r.project_id
      WHERE r.owner_id=? AND p.owner_id=? AND r.project_id=? AND r.kind=? ORDER BY r.created_at DESC,r.id DESC LIMIT 201`
        )
        .all(scope.owner, scope.owner, scope.project, kind) as Row[]
    ).map((row) => this.view<T>(row));
  }
  create<T>(
    scope: AutomationScope,
    kind: AutomationKind,
    key: string,
    fingerprint: string,
    body: T
  ): AutomationRecord<T> {
    return this.transaction(() => {
      this.assertWritable(scope);
      const previous = this.sql
        .prepare(
          `SELECT * FROM kosmora_automation_records WHERE owner_id=? AND project_id=? AND kind=? AND client_key=?`
        )
        .get(scope.owner, scope.project, kind, key) as Row | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AutomationStoreError("IDEMPOTENCY_CONFLICT");
        return this.view<T>(previous);
      }
      const json = this.json(body);
      this.quota(scope, kind, Buffer.byteLength(json));
      const id = randomUUID(),
        at = this.now();
      this.sql
        .prepare("INSERT INTO kosmora_automation_records VALUES(?,?,?,?,?,?,1,?,?,?)")
        .run(id, scope.project, scope.owner, kind, key, fingerprint, json, at, at);
      return this.get<T>(scope, kind, id)!;
    });
  }
  update<T>(
    scope: AutomationScope,
    kind: "playbook" | "schedule",
    id: string,
    version: number,
    body: T
  ): AutomationRecord<T> {
    return this.transaction(() => {
      this.assertWritable(scope);
      const current = this.get<T>(scope, kind, id);
      if (!current) throw new AutomationStoreError("AUTOMATION_NOT_FOUND");
      if (current.version !== version) throw new AutomationStoreError("STALE_AUTOMATION");
      const json = this.json(body);
      this.quota(
        scope,
        kind,
        Buffer.byteLength(json) - Buffer.byteLength(JSON.stringify(current.body)),
        false
      );
      const changed = this.sql
        .prepare(
          `UPDATE kosmora_automation_records SET version=version+1,body_json=?,updated_at=?
        WHERE id=? AND owner_id=? AND project_id=? AND kind=? AND version=?`
        )
        .run(json, this.now(), id, scope.owner, scope.project, kind, version);
      if (!changed.changes) throw new AutomationStoreError("STALE_AUTOMATION");
      return this.get<T>(scope, kind, id)!;
    });
  }
  private json(body: unknown): string {
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json) > 131072) throw new AutomationStoreError("AUTOMATION_SIZE_LIMIT");
    return json;
  }
  private quota(
    scope: AutomationScope,
    kind: AutomationKind,
    extra: number,
    creating = true
  ): void {
    const count = this.sql
      .prepare(
        "SELECT count(*) AS n FROM kosmora_automation_records WHERE owner_id=? AND project_id=? AND kind=?"
      )
      .get(scope.owner, scope.project, kind) as { n: number };
    const size = this.sql
      .prepare(
        "SELECT coalesce(sum(length(CAST(body_json AS BLOB))),0) AS n FROM kosmora_automation_records WHERE owner_id=?"
      )
      .get(scope.owner) as { n: number };
    if ((creating && count.n >= 200) || size.n + extra > 8_000_000)
      throw new AutomationStoreError("AUTOMATION_QUOTA_LIMIT");
  }
}
