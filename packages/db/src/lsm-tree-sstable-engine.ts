import { DatabaseSync } from "node:sqlite";

export interface LsmEntry {
  key: string;
  value: string | null;
  deleted: boolean; // Tombstone marker
  sequenceNumber: number;
}

export interface SstableMetadata {
  sstableId: string;
  level: number;
  minKey: string;
  maxKey: string;
  entryCount: number;
}

/**
 * Log-Structured Merge-Tree (LSM-Tree) Storage Engine with Sorted MemTable,
 * Tombstone Deletions, Sparse Fence Pointers (minKey/maxKey), and SSTable Compaction.
 */
export class LsmTreeSstableEngine {
  private readonly sqlite: DatabaseSync;
  private readonly ownerId: string;
  private readonly namespace: string;
  private readonly memTableLimit: number;
  private readonly memTable = new Map<string, LsmEntry>();
  private seqCounter = 0;
  private sstableCounter = 0;

  constructor(params: {
    sqlite: DatabaseSync;
    ownerId: string;
    namespace?: string;
    memTableLimit?: number;
  }) {
    this.sqlite = params.sqlite;
    this.ownerId = params.ownerId;
    this.namespace = params.namespace ?? "default";
    this.memTableLimit = Math.max(2, params.memTableLimit ?? 16);
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_lsm_sstables (
        sstable_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        min_key TEXT NOT NULL,
        max_key TEXT NOT NULL,
        entries_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
    `);
  }

  public put(key: string, value: string): void {
    this.memTable.set(key, {
      key,
      value,
      deleted: false,
      sequenceNumber: ++this.seqCounter
    });
    if (this.memTable.size >= this.memTableLimit) {
      this.flushMemTableToSstable();
    }
  }

  public delete(key: string): void {
    this.memTable.set(key, {
      key,
      value: null,
      deleted: true,
      sequenceNumber: ++this.seqCounter
    });
    if (this.memTable.size >= this.memTableLimit) {
      this.flushMemTableToSstable();
    }
  }

  public flushMemTableToSstable(level = 0): SstableMetadata | null {
    if (this.memTable.size === 0) return null;

    const sortedEntries = Array.from(this.memTable.values()).sort((a, b) =>
      a.key.localeCompare(b.key)
    );
    const minKey = sortedEntries[0]!.key;
    const maxKey = sortedEntries[sortedEntries.length - 1]!.key;
    const sstableId = `sst_${this.ownerId}_${this.namespace}_${++this.sstableCounter}`;

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_lsm_sstables
          (sstable_id, owner_id, namespace, level, min_key, max_key, entries_json, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sstableId,
        this.ownerId,
        this.namespace,
        level,
        minKey,
        maxKey,
        JSON.stringify(sortedEntries),
        this.seqCounter
      );

    this.memTable.clear();

    return {
      sstableId,
      level,
      minKey,
      maxKey,
      entryCount: sortedEntries.length
    };
  }

  /**
   * Point lookup: checks active MemTable first, then scans SSTables from newest to oldest
   * skipping any SSTable whose `[minKey, maxKey]` fence interval does not cover `key`.
   */
  public get(key: string): string | null {
    const inMem = this.memTable.get(key);
    if (inMem) {
      return inMem.deleted ? null : inMem.value;
    }

    const sstRows = this.sqlite
      .prepare(
        `SELECT min_key, max_key, entries_json
         FROM kosmora_lsm_sstables
         WHERE owner_id = ? AND namespace = ?
         ORDER BY created_at_ms DESC, sstable_id DESC`
      )
      .all(this.ownerId, this.namespace) as Array<{
      min_key: string;
      max_key: string;
      entries_json: string;
    }>;

    for (const row of sstRows) {
      // Fence pointer check
      if (key.localeCompare(row.min_key) < 0 || key.localeCompare(row.max_key) > 0) {
        continue;
      }
      const entries = JSON.parse(row.entries_json) as LsmEntry[];
      const found = entries.find((e) => e.key === key);
      if (found) {
        return found.deleted ? null : found.value;
      }
    }

    return null;
  }

  /**
   * Compacts all existing SSTables into a single Level-1 SSTable, deduplicating shadowed keys
   * by highest sequenceNumber and purging tombstones (`deleted: true`).
   */
  public compactSstables(): {
    mergedSstableId: string | null;
    liveKeysRetained: number;
    tombstonesPurged: number;
  } {
    this.flushMemTableToSstable();

    const rows = this.sqlite
      .prepare(
        `SELECT sstable_id, entries_json
         FROM kosmora_lsm_sstables
         WHERE owner_id = ? AND namespace = ?
         ORDER BY created_at_ms ASC, sstable_id ASC`
      )
      .all(this.ownerId, this.namespace) as Array<{
      sstable_id: string;
      entries_json: string;
    }>;

    if (rows.length === 0) {
      return { mergedSstableId: null, liveKeysRetained: 0, tombstonesPurged: 0 };
    }

    const latestByKey = new Map<string, LsmEntry>();
    for (const r of rows) {
      const entries = JSON.parse(r.entries_json) as LsmEntry[];
      for (const e of entries) {
        const prev = latestByKey.get(e.key);
        if (!prev || e.sequenceNumber > prev.sequenceNumber) {
          latestByKey.set(e.key, e);
        }
      }
    }

    let tombstonesPurged = 0;
    const liveEntries: LsmEntry[] = [];
    for (const entry of Array.from(latestByKey.values()).sort((a, b) =>
      a.key.localeCompare(b.key)
    )) {
      if (entry.deleted) {
        tombstonesPurged++;
      } else {
        liveEntries.push(entry);
      }
    }

    this.sqlite
      .prepare(`DELETE FROM kosmora_lsm_sstables WHERE owner_id = ? AND namespace = ?`)
      .run(this.ownerId, this.namespace);

    if (liveEntries.length === 0) {
      return { mergedSstableId: null, liveKeysRetained: 0, tombstonesPurged };
    }

    const mergedSstableId = `sst_${this.ownerId}_${this.namespace}_compacted_${++this.sstableCounter}`;
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_lsm_sstables
          (sstable_id, owner_id, namespace, level, min_key, max_key, entries_json, created_at_ms)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(
        mergedSstableId,
        this.ownerId,
        this.namespace,
        liveEntries[0]!.key,
        liveEntries[liveEntries.length - 1]!.key,
        JSON.stringify(liveEntries),
        ++this.seqCounter
      );

    return {
      mergedSstableId,
      liveKeysRetained: liveEntries.length,
      tombstonesPurged
    };
  }
}
