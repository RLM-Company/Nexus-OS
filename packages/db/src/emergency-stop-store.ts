import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EmergencyStopClearanceEvent, EmergencyStopState } from "@cosmora/contracts";
import { LOCAL_OWNER_ID, type StoredProject } from "./project-store.js";

type StopRow = {
  scope: "process" | "project";
  project_id: string | null;
  active: number;
  reason: string;
  activated_at: string;
  activated_by: string;
};

type ClearanceRow = {
  event_id: string;
  scope: "process" | "project";
  project_id: string | null;
  activation_reason: string;
  activated_at: string;
  activated_by: string;
  clearance_reason: string;
  cleared_at: string;
  cleared_by: string;
};

export interface ClearEmergencyStopInput {
  expectedActivatedAt: string;
  actorId: string;
  ownerId: string;
  reason: string;
}

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

const asClearanceEvent = (row: ClearanceRow): EmergencyStopClearanceEvent => ({
  event_id: row.event_id,
  scope: row.scope,
  project_id: row.project_id,
  activation_reason: row.activation_reason,
  activated_at: row.activated_at,
  activated_by: row.activated_by,
  clearance_reason: row.clearance_reason,
  cleared_at: row.cleared_at,
  cleared_by: row.cleared_by
});

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

  #nextActivationTimestamp(scopeKey: string): string {
    const currentMs = Date.now();
    const previous = this.#sqlite
      .prepare("SELECT activated_at FROM emergency_stops WHERE scope_key = ?")
      .get(scopeKey) as { activated_at?: string } | undefined;
    const previousMs = previous?.activated_at ? Date.parse(previous.activated_at) : Number.NaN;
    return new Date(
      Number.isFinite(previousMs) ? Math.max(currentMs, previousMs + 1) : currentMs
    ).toISOString();
  }

  activateProcess(reason: string, actorId = LOCAL_OWNER_ID): EmergencyStopState {
    const timestamp = this.#nextActivationTimestamp("process");
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
    const scopeKey = `project:${projectId}`;
    const timestamp = this.#nextActivationTimestamp(scopeKey);
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
      .run(scopeKey, projectId, reason, timestamp, actorId);
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

  clearProcess(input: ClearEmergencyStopInput): EmergencyStopClearanceEvent | null {
    return this.#clear("process", null, input);
  }

  clearProject(
    projectId: string,
    input: ClearEmergencyStopInput
  ): EmergencyStopClearanceEvent | null {
    if (!this.#ownedProject(projectId, input.ownerId)) return null;
    return this.#clear(`project:${projectId}`, projectId, input);
  }

  listRecentClearances(ownerId = LOCAL_OWNER_ID, limit = 50): EmergencyStopClearanceEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Emergency-stop clearance limit must be between 1 and 100");
    }
    const rows = this.#sqlite
      .prepare(
        `SELECT event_id, scope, project_id, activation_reason, activated_at, activated_by,
           clearance_reason, cleared_at, cleared_by
         FROM emergency_stop_clearance_events
         WHERE owner_id = ?
         ORDER BY cleared_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(ownerId, limit) as unknown as ClearanceRow[];
    return rows.map(asClearanceEvent);
  }

  #clear(
    scopeKey: string,
    projectId: string | null,
    input: ClearEmergencyStopInput
  ): EmergencyStopClearanceEvent | null {
    const clearanceReason = input.reason.trim();
    if (
      input.expectedActivatedAt.length === 0 ||
      input.actorId.length === 0 ||
      input.ownerId.length === 0 ||
      clearanceReason.length === 0 ||
      clearanceReason.length > 500
    ) {
      throw new Error("Emergency-stop clearance requires complete audit fields");
    }

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const active = this.#sqlite
        .prepare(
          `SELECT scope, project_id, active, reason, activated_at, activated_by
           FROM emergency_stops WHERE scope_key = ? AND active = 1`
        )
        .get(scopeKey) as StopRow | undefined;
      if (
        !active ||
        active.project_id !== projectId ||
        active.activated_at !== input.expectedActivatedAt ||
        (active.scope === "process" && active.activated_by === "system:environment")
      ) {
        this.#sqlite.exec("ROLLBACK;");
        return null;
      }

      const clearedAt = now();
      const update = this.#sqlite
        .prepare(
          `UPDATE emergency_stops SET active = 0, cleared_at = ?, cleared_by = ?
           WHERE scope_key = ? AND active = 1 AND activated_at = ?`
        )
        .run(clearedAt, input.actorId, scopeKey, input.expectedActivatedAt);
      if (Number(update.changes) !== 1) {
        this.#sqlite.exec("ROLLBACK;");
        return null;
      }

      const event: EmergencyStopClearanceEvent = {
        event_id: randomUUID(),
        scope: active.scope,
        project_id: active.project_id,
        activation_reason: active.reason,
        activated_at: active.activated_at,
        activated_by: active.activated_by,
        clearance_reason: clearanceReason,
        cleared_at: clearedAt,
        cleared_by: input.actorId
      };
      this.#sqlite
        .prepare(
          `INSERT INTO emergency_stop_clearance_events
            (event_id, owner_id, scope_key, scope, project_id, activation_reason, activated_at,
             activated_by, clearance_reason, cleared_at, cleared_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.event_id,
          input.ownerId,
          scopeKey,
          event.scope,
          event.project_id,
          event.activation_reason,
          event.activated_at,
          event.activated_by,
          event.clearance_reason,
          event.cleared_at,
          event.cleared_by
        );
      this.#sqlite.exec("COMMIT;");
      return event;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }
}
