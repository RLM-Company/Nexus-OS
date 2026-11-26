import type { DatabaseSync } from "node:sqlite";

/** Minimal structural mirror of @cosmora/core StarsMission. Kept local so the
 * DB package does not gain a runtime dependency on core. */
export type StoredStarsMission = {
  id: string;
  team_scope: string;
  version: number;
  [key: string]: unknown;
};

export class StarsMissionConflict extends Error {}

/** Durable Stars missions. State lives as an immutable-on-version JSON blob;
 * team scope and owner are indexed for the Stars map and event triggers. */
export class StarsMissionStore {
  constructor(private readonly db: DatabaseSync) {}

  get(missionId: string, ownerId: string): StoredStarsMission | null {
    const row = this.db
      .prepare("SELECT state_json FROM stars_missions WHERE mission_id=? AND owner_id=?")
      .get(missionId, ownerId) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as StoredStarsMission) : null;
  }

  list(ownerId: string, teamScope?: string): StoredStarsMission[] {
    const rows = (
      teamScope
        ? this.db
            .prepare(
              "SELECT state_json FROM stars_missions WHERE owner_id=? AND team_scope=? ORDER BY updated_at DESC"
            )
            .all(ownerId, teamScope)
        : this.db
            .prepare(
              "SELECT state_json FROM stars_missions WHERE owner_id=? ORDER BY updated_at DESC"
            )
            .all(ownerId)
    ) as { state_json: string }[];
    return rows.map((row) => JSON.parse(row.state_json) as StoredStarsMission);
  }

  /** CAS by mission version. A stale write is rejected before any mutation. */
  save(next: StoredStarsMission, ownerId: string, expectedVersion: number): StoredStarsMission {
    const current = this.get(next.id, ownerId);
    const expected = current?.version ?? 0;
    if (expectedVersion !== expected || next.version !== expected + 1)
      throw new StarsMissionConflict("STALE_MISSION_VERSION");
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO stars_missions(mission_id,owner_id,team_scope,version,state_json,created_at,updated_at) " +
          "VALUES(?,?,?,?,?,?,?) ON CONFLICT(mission_id,owner_id) DO UPDATE SET " +
          "team_scope=excluded.team_scope,version=excluded.version,state_json=excluded.state_json,updated_at=excluded.updated_at"
      )
      .run(next.id, ownerId, next.team_scope, next.version, JSON.stringify(next), now, now);
    return next;
  }
}
