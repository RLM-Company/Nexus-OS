import { DatabaseSync } from "node:sqlite";

export interface SnapshotDiffReport {
  fromRevision: number;
  toRevision: number;
  addedKeys: Record<string, string>;
  modifiedKeys: Record<string, { before: string; after: string }>;
  deletedKeys: string[];
}

/**
 * SQLite Multi-Version Time-Travel Snapshot Differ (`kosmora_snapshot_revisions`).
 * Captures immutable revision snapshots of key-value state and computes exact structural
 * diffs (added, modified, deleted) between any two historical revision numbers.
 */
export class TimeTravelSnapshotDiffInspector {
  private readonly db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_snapshot_revisions (
        revision_id INTEGER NOT NULL,
        state_key TEXT NOT NULL,
        state_value TEXT NOT NULL,
        PRIMARY KEY (revision_id, state_key)
      );
    `);
  }

  public commitSnapshot(revisionId: number, stateMap: Record<string, string>): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO kosmora_snapshot_revisions (revision_id, state_key, state_value)
       VALUES (?, ?, ?)`
    );
    for (const [k, v] of Object.entries(stateMap)) {
      stmt.run(revisionId, k, v);
    }
  }

  public getSnapshot(revisionId: number): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT state_key, state_value
         FROM kosmora_snapshot_revisions
         WHERE revision_id = ?`
      )
      .all(revisionId) as Array<{ state_key: string; state_value: string }>;
    return new Map(rows.map((r) => [r.state_key, r.state_value]));
  }

  public diffRevisions(fromRevision: number, toRevision: number): SnapshotDiffReport {
    const beforeMap = this.getSnapshot(fromRevision);
    const afterMap = this.getSnapshot(toRevision);

    const addedKeys: Record<string, string> = {};
    const modifiedKeys: Record<string, { before: string; after: string }> = {};
    const deletedKeys: string[] = [];

    for (const [k, afterVal] of afterMap.entries()) {
      if (!beforeMap.has(k)) {
        addedKeys[k] = afterVal;
      } else {
        const beforeVal = beforeMap.get(k)!;
        if (beforeVal !== afterVal) {
          modifiedKeys[k] = { before: beforeVal, after: afterVal };
        }
      }
    }

    for (const k of beforeMap.keys()) {
      if (!afterMap.has(k)) {
        deletedKeys.push(k);
      }
    }
    deletedKeys.sort();

    return {
      fromRevision,
      toRevision,
      addedKeys,
      modifiedKeys,
      deletedKeys
    };
  }
}
