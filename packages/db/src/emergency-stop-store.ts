import type { DatabaseSync } from "node:sqlite";
import type { EmergencyStopState } from "@cosmora/contracts";
import { LOCAL_OWNER_ID, type StoredProject } from "./project-store.js";

type StopRow = {
  scope: "process" | "project";
  project_id: string | null;
  active: number;
  reason: string;
  activated_at: string;
  activated_by: string;
};

const now = (): string => new Date().toISOString();

const asState = (row: StopRow | undefined): EmergencyStopState | null =>
  row && row.active === 1
    ? {
        scope: row.scope,
        project_id: row.project_id,
        active: true,
        reason: row.reason,
        activated_at: row.activated_at,
        activated_by: row.activated_by
      }
    : null;

export class EmergencyStopStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  #ownedProject(projectId: string, ownerId: string): StoredProject | null {
    const row = this.#sqlite
      .prepare(
        "SELECT id, title, status, created_at, updated_at FROM projects WHERE id = ? AND owner_id = ?"
      )
      .get(projectId, ownerId) as StoredProject | undefined;
    return row ?? null;
  }

  activateProcess(reason: string, actorId = LOCAL_OWNER_ID): EmergencyStopState {
    const timestamp = now();
    this.#sqlite
      .prepare(
        `INSERT INTO emergency_stops
          (scope_key, scope, project_id, active, reason, activated_at, activated_by,
           cleared_at, cleared_by)
         VALUES ('process', 'process', NULL, 1, ?, ?, ?, NULL, NULL)
         ON CONFLICT(scope_key) DO UPDATE SET active = 1, reason = excluded.reason,
           activated_at = excluded.activated_at, activated_by = excluded.activated_by,
           cleared_at = NULL, cleared_by = NULL`
      )
      .run(reason, timestamp, actorId);
    return this.getProcessStop() as EmergencyStopState;
  }

  activateProject(
    projectId: string,
    reason: string,
    actorId = LOCAL_OWNER_ID,
    ownerId = LOCAL_OWNER_ID
  ): EmergencyStopState | null {
    if (!this.#ownedProject(projectId, ownerId)) return null;
    const timestamp = now();
    this.#sqlite
      .prepare(
        `INSERT INTO emergency_stops
          (scope_key, scope, project_id, active, reason, activated_at, activated_by,
           cleared_at, cleared_by)
         VALUES (?, 'project', ?, 1, ?, ?, ?, NULL, NULL)
         ON CONFLICT(scope_key) DO UPDATE SET active = 1, reason = excluded.reason,
           activated_at = excluded.activated_at, activated_by = excluded.activated_by,
           cleared_at = NULL, cleared_by = NULL`
      )
      .run(`project:${projectId}`, projectId, reason, timestamp, actorId);
    return this.getProjectStop(projectId, ownerId);
  }

  getProcessStop(): EmergencyStopState | null {
    return asState(
      this.#sqlite
        .prepare(
          `SELECT scope, project_id, active, reason, activated_at, activated_by
           FROM emergency_stops WHERE scope_key = 'process'`
        )
        .get() as StopRow | undefined
    );
  }

  getProjectStop(projectId: string, ownerId = LOCAL_OWNER_ID): EmergencyStopState | null {
    if (!this.#ownedProject(projectId, ownerId)) return null;
    return asState(
      this.#sqlite
        .prepare(
          `SELECT scope, project_id, active, reason, activated_at, activated_by
           FROM emergency_stops WHERE scope_key = ?`
        )
        .get(`project:${projectId}`) as StopRow | undefined
    );
  }

  getBlockingStop(projectId: string, ownerId = LOCAL_OWNER_ID): EmergencyStopState | null {
    return this.getProcessStop() ?? this.getProjectStop(projectId, ownerId);
  }

  countActiveProjectStops(ownerId = LOCAL_OWNER_ID): number {
    const row = this.#sqlite
      .prepare(
        `SELECT count(*) AS count FROM emergency_stops e
         JOIN projects p ON p.id = e.project_id
         WHERE e.scope = 'project' AND e.active = 1 AND p.owner_id = ?`
      )
      .get(ownerId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  clearProcess(actorId = LOCAL_OWNER_ID): boolean {
    const result = this.#sqlite
      .prepare(
        `UPDATE emergency_stops SET active = 0, cleared_at = ?, cleared_by = ?
         WHERE scope_key = 'process' AND active = 1`
      )
      .run(now(), actorId);
    return Number(result.changes) === 1;
  }

  clearProject(projectId: string, actorId = LOCAL_OWNER_ID, ownerId = LOCAL_OWNER_ID): boolean {
    if (!this.#ownedProject(projectId, ownerId)) return false;
    const result = this.#sqlite
      .prepare(
        `UPDATE emergency_stops SET active = 0, cleared_at = ?, cleared_by = ?
         WHERE scope_key = ? AND active = 1`
      )
      .run(now(), actorId, `project:${projectId}`);
    return Number(result.changes) === 1;
  }
}
