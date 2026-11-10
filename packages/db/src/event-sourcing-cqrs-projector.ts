import { DatabaseSync } from "node:sqlite";

export interface DomainEventRecord<TPayload = Record<string, unknown>> {
  aggregateId: string;
  version: number;
  eventType: string;
  payload: TPayload;
  timestampMs: number;
}

export interface AggregateProjectionResult<TState> {
  aggregateId: string;
  version: number;
  state: TState;
  restoredFromSnapshotVersion: number;
  eventsReplayedCount: number;
}

/**
 * Append-Only Event Sourcing Log & CQRS Materialized Read-Model Projector.
 * Enforces Optimistic Concurrency Control (`EXPECTED_VERSION_CONFLICT`), rolling state snapshots,
 * and point-in-time historical state replay (`upToVersion` / `upToTimestampMs`).
 */
export class EventSourcingCqrsProjector<TState = Record<string, unknown>> {
  private readonly sqlite: DatabaseSync;
  private readonly reducerFn: (state: TState, event: DomainEventRecord) => TState;
  private readonly initialStateFn: () => TState;
  private readonly snapshotInterval: number;

  constructor(params: {
    sqlite: DatabaseSync;
    initialStateFn: () => TState;
    reducerFn: (state: TState, event: DomainEventRecord) => TState;
    snapshotInterval?: number;
  }) {
    this.sqlite = params.sqlite;
    this.initialStateFn = params.initialStateFn;
    this.reducerFn = params.reducerFn;
    this.snapshotInterval = Math.max(2, params.snapshotInterval ?? 5);
    this.ensureTables();
  }

  private ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_event_store_stream (
        aggregate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        PRIMARY KEY (aggregate_id, version)
      );

      CREATE TABLE IF NOT EXISTS kosmora_event_store_snapshots (
        aggregate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        PRIMARY KEY (aggregate_id, version)
      );
    `);
  }

  public getCurrentVersion(aggregateId: string): number {
    const row = this.sqlite
      .prepare(
        `SELECT MAX(version) AS max_ver FROM kosmora_event_store_stream WHERE aggregate_id = ?`
      )
      .get(aggregateId) as { max_ver: number | null } | undefined;
    return row?.max_ver ?? 0;
  }

  public appendEvent(params: {
    aggregateId: string;
    expectedVersion: number;
    eventType: string;
    payload: Record<string, unknown>;
    timestampMs?: number;
  }): DomainEventRecord {
    const currentVer = this.getCurrentVersion(params.aggregateId);
    if (currentVer !== params.expectedVersion) {
      throw new Error(
        `EXPECTED_VERSION_CONFLICT: aggregate '${params.aggregateId}' is at v${currentVer}, expected v${params.expectedVersion}`
      );
    }

    const nextVer = currentVer + 1;
    const ts = params.timestampMs ?? Date.now();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_event_store_stream
          (aggregate_id, version, event_type, payload_json, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        params.aggregateId,
        nextVer,
        params.eventType,
        JSON.stringify(params.payload),
        ts
      );

    if (nextVer % this.snapshotInterval === 0) {
      const projected = this.projectState(params.aggregateId, { upToVersion: nextVer });
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_event_store_snapshots
            (aggregate_id, version, state_json, timestamp_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(aggregate_id, version) DO UPDATE SET
            state_json = excluded.state_json,
            timestamp_ms = excluded.timestamp_ms`
        )
        .run(params.aggregateId, nextVer, JSON.stringify(projected.state), ts);
    }

    return {
      aggregateId: params.aggregateId,
      version: nextVer,
      eventType: params.eventType,
      payload: params.payload,
      timestampMs: ts
    };
  }

  public projectState(
    aggregateId: string,
    options?: { upToVersion?: number; upToTimestampMs?: number }
  ): AggregateProjectionResult<TState> {
    const maxVersion = options?.upToVersion ?? Number.MAX_SAFE_INTEGER;
    const maxTs = options?.upToTimestampMs ?? Number.MAX_SAFE_INTEGER;

    // Find latest snapshot <= maxVersion and <= maxTs
    const snapRow = this.sqlite
      .prepare(
        `SELECT version, state_json
         FROM kosmora_event_store_snapshots
         WHERE aggregate_id = ? AND version <= ? AND timestamp_ms <= ?
         ORDER BY version DESC LIMIT 1`
      )
      .get(aggregateId, maxVersion, maxTs) as
      | { version: number; state_json: string }
      | undefined;

    let state: TState = snapRow
      ? (JSON.parse(snapRow.state_json) as TState)
      : this.initialStateFn();
    const restoredFromSnapshotVersion = snapRow ? snapRow.version : 0;

    const eventRows = this.sqlite
      .prepare(
        `SELECT version, event_type, payload_json, timestamp_ms
         FROM kosmora_event_store_stream
         WHERE aggregate_id = ? AND version > ? AND version <= ? AND timestamp_ms <= ?
         ORDER BY version ASC`
      )
      .all(aggregateId, restoredFromSnapshotVersion, maxVersion, maxTs) as Array<{
      version: number;
      event_type: string;
      payload_json: string;
      timestamp_ms: number;
    }>;

    let currentVer = restoredFromSnapshotVersion;
    for (const r of eventRows) {
      state = this.reducerFn(state, {
        aggregateId,
        version: r.version,
        eventType: r.event_type,
        payload: JSON.parse(r.payload_json),
        timestampMs: r.timestamp_ms
      });
      currentVer = r.version;
    }

    return {
      aggregateId,
      version: currentVer,
      state,
      restoredFromSnapshotVersion,
      eventsReplayedCount: eventRows.length
    };
  }
}
