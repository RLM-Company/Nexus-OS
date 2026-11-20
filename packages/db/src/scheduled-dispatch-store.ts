import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type DispatchKind = "message" | "work_task" | "koscode_task" | "team_task";
export type DispatchMode = "once" | "daily" | "weekdays" | "weekly";
export type DispatchStatus = "scheduled" | "ready" | "dispatched" | "cancelled";
export type ScheduledDispatch = {
  id: string;
  owner_id: string;
  client_request_id: string;
  chat_id: string | null;
  project_id: string | null;
  kind: DispatchKind;
  mode: DispatchMode;
  due_at: string;
  payload: { text: string; title?: string };
  status: DispatchStatus;
  created_at: string;
  updated_at: string;
};
export class ScheduledDispatchError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN") {
    super(code);
  }
}
type Row = Omit<ScheduledDispatch, "payload"> & { payload_json: string };
const decode = (row: Row): ScheduledDispatch => ({
  ...row,
  chat_id: row.chat_id ?? null,
  project_id: row.project_id ?? null,
  payload: JSON.parse(row.payload_json) as ScheduledDispatch["payload"]
});

/** Persisted schedule for delayed chat messages and task placement.
 * No background timer: a due row becomes `ready` only on an explicit tick. */
export class ScheduledDispatchStore {
  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  create(input: {
    ownerId: string;
    clientRequestId: string;
    chatId: string | null;
    projectId: string | null;
    kind: DispatchKind;
    mode: DispatchMode;
    dueAt: string;
    payload: ScheduledDispatch["payload"];
  }): ScheduledDispatch {
    const kinds: DispatchKind[] = ["message", "work_task", "koscode_task", "team_task"];
    const modes: DispatchMode[] = ["once", "daily", "weekdays", "weekly"];
    if (
      !input.ownerId ||
      !input.clientRequestId ||
      !kinds.includes(input.kind) ||
      !modes.includes(input.mode) ||
      !Number.isFinite(Date.parse(input.dueAt)) ||
      new Date(input.dueAt).toISOString() !== input.dueAt ||
      !input.payload?.text?.trim() ||
      input.payload.text.length > 100_000 ||
      (input.kind === "message" && !input.chatId) ||
      (input.kind !== "message" && !input.projectId)
    )
      throw new ScheduledDispatchError("INVALID_INPUT");
    // Идемпотентность: повтор того же client_request_id возвращает прежнюю запись.
    const existing = this.sql
      .prepare("SELECT * FROM scheduled_dispatches WHERE owner_id=? AND client_request_id=?")
      .get(input.ownerId, input.clientRequestId) as Row | undefined;
    if (existing) {
      if (
        existing.kind !== input.kind ||
        existing.due_at !== input.dueAt ||
        existing.chat_id !== (input.chatId ?? null) ||
        existing.project_id !== (input.projectId ?? null)
      )
        throw new ScheduledDispatchError("CONFLICT");
      return decode(existing);
    }
    const at = this.now();
    const id = randomUUID();
    this.sql
      .prepare(
        `INSERT INTO scheduled_dispatches
          (id,owner_id,client_request_id,chat_id,project_id,kind,mode,due_at,payload_json,status,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.ownerId,
        input.clientRequestId,
        input.chatId ?? null,
        input.projectId ?? null,
        input.kind,
        input.mode,
        input.dueAt,
        JSON.stringify(input.payload),
        "scheduled",
        at,
        at
      );
    return this.get(id, input.ownerId)!;
  }

  get(id: string, ownerId: string): ScheduledDispatch | null {
    const row = this.sql
      .prepare("SELECT * FROM scheduled_dispatches WHERE id=? AND owner_id=?")
      .get(id, ownerId) as Row | undefined;
    return row ? decode(row) : null;
  }

  list(ownerId: string): ScheduledDispatch[] {
    return (
      this.sql
        .prepare("SELECT * FROM scheduled_dispatches WHERE owner_id=? ORDER BY due_at ASC, id ASC")
        .all(ownerId) as Row[]
    ).map(decode);
  }

  /** Только записи этого владельца, готовые к тику. */
  due(ownerId: string, nowIso: string): ScheduledDispatch[] {
    return (
      this.sql
        .prepare(
          "SELECT * FROM scheduled_dispatches WHERE owner_id=? AND status='scheduled' AND due_at<=? ORDER BY due_at ASC"
        )
        .all(ownerId, nowIso) as Row[]
    ).map(decode);
  }

  markReady(ids: string[], ownerId: string): void {
    const at = this.now();
    const stmt = this.sql.prepare(
      "UPDATE scheduled_dispatches SET status='ready', updated_at=? WHERE id=? AND owner_id=? AND status='scheduled'"
    );
    for (const id of ids) stmt.run(at, id, ownerId);
  }

  reschedule(id: string, ownerId: string, nextDueAt: string): void {
    this.sql
      .prepare(
        "UPDATE scheduled_dispatches SET due_at=?, status='scheduled', updated_at=? WHERE id=? AND owner_id=? AND status='ready'"
      )
      .run(nextDueAt, this.now(), id, ownerId);
  }

  markDispatched(id: string, ownerId: string): boolean {
    const result = this.sql
      .prepare(
        "UPDATE scheduled_dispatches SET status='dispatched', updated_at=? WHERE id=? AND owner_id=? AND status='ready'"
      )
      .run(this.now(), id, ownerId);
    return result.changes === 1;
  }

  cancel(id: string, ownerId: string): boolean {
    const result = this.sql
      .prepare(
        "UPDATE scheduled_dispatches SET status='cancelled', updated_at=? WHERE id=? AND owner_id=? AND status IN ('scheduled','ready')"
      )
      .run(this.now(), id, ownerId);
    return result.changes === 1;
  }
}
