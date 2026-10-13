import type { DatabaseSync } from "node:sqlite";

export type NotificationPreferences = {
  in_app_enabled: boolean;
  browser_enabled: boolean;
  quiet_from: string | null;
  quiet_until: string | null;
  time_zone: string;
};
export type OwnerNotification = {
  id: string;
  source: "work" | "research";
  source_id: string;
  kind: string;
  title: string;
  href: string;
  occurred_at: string;
  read: boolean;
};
type SourceRow = { id: string; status: string; version?: number; updated_at: string };

export class NotificationError extends Error {
  constructor(readonly code: "INVALID_PREFERENCES" | "NOT_FOUND" | "OWNER_DATA_FENCED") {
    super(code);
  }
}

const defaultPrefs: NotificationPreferences = {
  in_app_enabled: true,
  browser_enabled: false,
  quiet_from: null,
  quiet_until: null,
  time_zone: "Europe/Moscow"
};
const isClock = (value: unknown): value is string =>
  typeof value === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/u.test(value);
const validatePreferences = (value: NotificationPreferences) => {
  if (
    typeof value?.in_app_enabled !== "boolean" ||
    typeof value.browser_enabled !== "boolean" ||
    (value.quiet_from === null) !== (value.quiet_until === null) ||
    (value.quiet_from !== null &&
      (!isClock(value.quiet_from) ||
        !isClock(value.quiet_until) ||
        value.quiet_from === value.quiet_until)) ||
    typeof value.time_zone !== "string" ||
    value.time_zone.length > 64
  )
    throw new NotificationError("INVALID_PREFERENCES");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.time_zone });
  } catch {
    throw new NotificationError("INVALID_PREFERENCES");
  }
};

/** State-derived notifications. Nothing sends externally and GET never writes. */
export class NotificationStore {
  constructor(
    private readonly sql: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  private writable(owner: string) {
    if (
      this.sql
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new NotificationError("OWNER_DATA_FENCED");
  }
  preferences(owner: string): NotificationPreferences {
    const row = this.sql
      .prepare(
        "SELECT in_app_enabled,browser_enabled,quiet_from,quiet_until,time_zone FROM notification_preferences WHERE owner_id=?"
      )
      .get(owner) as
      | {
          in_app_enabled: number;
          browser_enabled: number;
          quiet_from: string | null;
          quiet_until: string | null;
          time_zone: string;
        }
      | undefined;
    return row
      ? {
          in_app_enabled: Boolean(row.in_app_enabled),
          browser_enabled: Boolean(row.browser_enabled),
          quiet_from: row.quiet_from,
          quiet_until: row.quiet_until,
          time_zone: row.time_zone
        }
      : { ...defaultPrefs };
  }
  savePreferences(owner: string, input: NotificationPreferences): NotificationPreferences {
    validatePreferences(input);
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      this.sql
        .prepare(
          `INSERT INTO notification_preferences(owner_id,in_app_enabled,browser_enabled,quiet_from,quiet_until,time_zone,updated_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,
        browser_enabled=excluded.browser_enabled,quiet_from=excluded.quiet_from,quiet_until=excluded.quiet_until,
        time_zone=excluded.time_zone,updated_at=excluded.updated_at`
        )
        .run(
          owner,
          Number(input.in_app_enabled),
          Number(input.browser_enabled),
          input.quiet_from,
          input.quiet_until,
          input.time_zone,
          this.now()
        );
      this.sql.exec("COMMIT");
      return this.preferences(owner);
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
  list(owner: string): { items: OwnerNotification[]; unread: number } {
    const work = this.sql
      .prepare(
        `SELECT id,version,json_extract(state_json,'$.status') AS status,
      json_extract(state_json,'$.updated_at') AS updated_at FROM manager_work
      WHERE owner_id=? AND json_extract(state_json,'$.status') IN ('awaiting_approval','blocked','completed','failed')
      ORDER BY json_extract(state_json,'$.updated_at') DESC LIMIT 100`
      )
      .all(owner) as unknown as SourceRow[];
    const research = this.sql
      .prepare(
        `SELECT id,status,updated_at FROM research_v1_runs
      WHERE owner_id=? AND status IN ('completed','failed','paused') ORDER BY updated_at DESC LIMIT 100`
      )
      .all(owner) as unknown as SourceRow[];
    const workTitles: Record<string, string> = {
      awaiting_approval: "Задача Work ждёт подтверждения",
      blocked: "Задача Work остановлена",
      completed: "Задача Work завершена",
      failed: "Задача Work завершилась с ошибкой"
    };
    const researchTitles: Record<string, string> = {
      completed: "Исследование завершено",
      failed: "Исследование завершилось с ошибкой",
      paused: "Исследование приостановлено"
    };
    const events = [
      ...work.map((row) => ({
        id: `work:${row.id}:${row.status}:${row.version}`,
        source: "work" as const,
        source_id: row.id,
        kind: row.status,
        title: workTitles[row.status] ?? "Задача Work",
        href: "/",
        occurred_at: row.updated_at
      })),
      ...research.map((row) => ({
        id: `research:${row.id}:${row.status}:${row.updated_at}`,
        source: "research" as const,
        source_id: row.id,
        kind: row.status,
        title: researchTitles[row.status] ?? "Исследование",
        href: "/research-workspace",
        occurred_at: row.updated_at
      }))
    ]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 100);
    const read = this.sql.prepare(
      "SELECT 1 FROM notification_reads WHERE owner_id=? AND event_key=?"
    );
    const items = events.map((event) => ({ ...event, read: Boolean(read.get(owner, event.id)) }));
    return { items, unread: items.filter((item) => !item.read).length };
  }
  mark(owner: string, ids: string[]): number {
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || id.length > 200)
    )
      throw new NotificationError("NOT_FOUND");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.writable(owner);
      const events = new Set(this.list(owner).items.map((item) => item.id));
      if (ids.some((id) => !events.has(id))) throw new NotificationError("NOT_FOUND");
      const insert = this.sql.prepare(
        "INSERT OR IGNORE INTO notification_reads(owner_id,event_key,read_at) VALUES(?,?,?)"
      );
      let count = 0;
      for (const id of ids) count += Number(insert.run(owner, id, this.now()).changes);
      this.sql.exec("COMMIT");
      return count;
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
}
