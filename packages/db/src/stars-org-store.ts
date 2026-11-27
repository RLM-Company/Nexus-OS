import type { DatabaseSync } from "node:sqlite";

/** Durable, versioned Stars team compositions. Each version is immutable;
 * history is kept so older missions resolve the roster they started with. */
export type StoredStarsOrg = {
  team_scope: string;
  version: number;
  nodes: Array<{
    id: string;
    role: string;
    manager_id: string | null;
    responsibility_zones: string[];
    project_ids: string[];
    status: "active" | "removed";
    effective_from: string;
  }>;
  checksum: string;
};
export class StarsOrgStoreConflict extends Error {
  constructor(readonly code: "STALE_VERSION" | "NOT_FOUND") {
    super(code);
  }
}
export class StarsOrgStore {
  constructor(private readonly sqlite: DatabaseSync) {}

  current(teamScope: string, ownerId: string): StoredStarsOrg | null {
    const row = this.sqlite
      .prepare(
        "SELECT state_json FROM stars_org_snapshots WHERE team_scope=? AND owner_id=? ORDER BY version DESC LIMIT 1"
      )
      .get(teamScope, ownerId) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as StoredStarsOrg) : null;
  }

  version(teamScope: string, ownerId: string, version: number): StoredStarsOrg | null {
    const row = this.sqlite
      .prepare(
        "SELECT state_json FROM stars_org_snapshots WHERE team_scope=? AND owner_id=? AND version=?"
      )
      .get(teamScope, ownerId, version) as { state_json: string } | undefined;
    return row ? (JSON.parse(row.state_json) as StoredStarsOrg) : null;
  }

  /** Save only the exact next version. A failed insert writes nothing. */
  save(next: StoredStarsOrg, ownerId: string, expectedVersion: number): StoredStarsOrg {
    const current = this.current(next.team_scope, ownerId);
    if ((current?.version ?? 0) !== expectedVersion || next.version !== expectedVersion + 1)
      throw new StarsOrgStoreConflict("STALE_VERSION");
    const at = new Date().toISOString();
    this.sqlite
      .prepare(
        "INSERT INTO stars_org_snapshots(team_scope,owner_id,version,state_json,created_at) VALUES(?,?,?,?,?)"
      )
      .run(next.team_scope, ownerId, next.version, JSON.stringify(next), at);
    return next;
  }
}
