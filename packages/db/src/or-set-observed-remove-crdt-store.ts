import { DatabaseSync } from "node:sqlite";

export interface OrSetElementTag {
  elementValue: string;
  uniqueTag: string;
  replicaId: string;
}

/**
 * Conflict-Free Replicated Observed-Remove Set (OR-Set / Add-Wins CRDT) backed by SQLite.
 * Each add(element) mints a globally unique causal tag (replicaId:seq).
 * remove(element) tombstones only the tags currently observed at the local replica, so a
 * concurrent add(element) with an unobserved tag survives merge (Add-Wins semantics).
 */
export class ObservedRemoveSetDeltaCrdtStore {
  private readonly db: DatabaseSync;
  private readonly replicaId: string;
  private localCounter = 0;

  public constructor(db: DatabaseSync, replicaId: string = "replica_1") {
    this.db = db;
    this.replicaId = replicaId;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_orset_elements (
        unique_tag TEXT PRIMARY KEY,
        element_value TEXT NOT NULL,
        replica_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kosmora_orset_tombstones (
        unique_tag TEXT PRIMARY KEY
      );
    `);
  }

  public add(elementValue: string): OrSetElementTag {
    this.localCounter++;
    const uniqueTag = `${this.replicaId}:${this.localCounter}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO kosmora_orset_elements (unique_tag, element_value, replica_id)
         VALUES (?, ?, ?)`
      )
      .run(uniqueTag, elementValue, this.replicaId);
    return { elementValue, uniqueTag, replicaId: this.replicaId };
  }

  public removeObserved(elementValue: string): string[] {
    const activeRows = this.db
      .prepare(
        `SELECT e.unique_tag
         FROM kosmora_orset_elements e
         LEFT JOIN kosmora_orset_tombstones t ON e.unique_tag = t.unique_tag
         WHERE e.element_value = ? AND t.unique_tag IS NULL`
      )
      .all(elementValue) as Array<{ unique_tag: string }>;

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO kosmora_orset_tombstones (unique_tag) VALUES (?)`
    );
    const tombstoned: string[] = [];
    for (const r of activeRows) {
      stmt.run(r.unique_tag);
      tombstoned.push(r.unique_tag);
    }
    return tombstoned;
  }

  public mergeRemoteDelta(delta: {
    addedTags: OrSetElementTag[];
    removedTags: string[];
  }): void {
    const addStmt = this.db.prepare(
      `INSERT OR IGNORE INTO kosmora_orset_elements (unique_tag, element_value, replica_id)
       VALUES (?, ?, ?)`
    );
    const remStmt = this.db.prepare(
      `INSERT OR IGNORE INTO kosmora_orset_tombstones (unique_tag) VALUES (?)`
    );
    for (const a of delta.addedTags) {
      addStmt.run(a.uniqueTag, a.elementValue, a.replicaId);
    }
    for (const tag of delta.removedTags) {
      remStmt.run(tag);
    }
  }

  public values(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT e.element_value
         FROM kosmora_orset_elements e
         LEFT JOIN kosmora_orset_tombstones t ON e.unique_tag = t.unique_tag
         WHERE t.unique_tag IS NULL
         ORDER BY e.element_value ASC`
      )
      .all() as Array<{ element_value: string }>;
    return rows.map((r) => r.element_value);
  }
}
