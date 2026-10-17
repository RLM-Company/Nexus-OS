import type { DatabaseSync } from "node:sqlite";
import {
  CHAT_SKILLS_MAX_COUNT,
  CHAT_SKILLS_MAX_BYTES,
  type ChatSkillReference,
  type ChatSkillSnapshot,
  type ChatSkillSelection
} from "@cosmora/contracts";

export class ChatSkillError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

/** Selection is versioned; accepted runs retain text independently of the mutable catalog. */
export class ChatSkillStore {
  constructor(private readonly sql: DatabaseSync) {}
  private assertChat(chatId: string, ownerId: string) {
    if (
      !this.sql
        .prepare("SELECT 1 FROM general_chats WHERE id=? AND owner_id=?")
        .get(chatId, ownerId)
    )
      throw new ChatSkillError(404, "Чат не найден.");
  }
  get(chatId: string, ownerId: string): ChatSkillSelection {
    this.assertChat(chatId, ownerId);
    const current = this.sql
      .prepare("SELECT version,updated_at FROM chat_skill_settings WHERE chat_id=?")
      .get(chatId) as { version: number; updated_at: string } | undefined;
    const items = this.sql
      .prepare(
        `SELECT s.skill_id,s.version,v.name,v.summary,v.instructions
      FROM chat_skill_selections s JOIN owner_skill_versions v ON v.skill_id=s.skill_id AND v.version=s.version
      WHERE s.chat_id=? AND v.owner_id=? ORDER BY s.position`
      )
      .all(chatId, ownerId) as unknown as ChatSkillSnapshot[];
    return { version: current?.version ?? 0, updated_at: current?.updated_at ?? null, items };
  }
  update(
    chatId: string,
    ownerId: string,
    expectedVersion: number,
    refs: ChatSkillReference[]
  ): ChatSkillSelection {
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(refs) ||
      refs.length > CHAT_SKILLS_MAX_COUNT ||
      new Set(refs.map((x) => x.skill_id)).size !== refs.length
    )
      throw new ChatSkillError(400, "Выберите до трёх разных Skills.");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(chatId, ownerId);
      if (
        this.sql
          .prepare(
            "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
          )
          .get(ownerId)
      )
        throw new ChatSkillError(409, "Данные аккаунта временно недоступны для изменения.");
      if (
        this.sql
          .prepare(
            "SELECT 1 FROM general_chat_runs WHERE chat_id=? AND status IN ('queued','running')"
          )
          .get(chatId)
      )
        throw new ChatSkillError(409, "Остановите ответ перед изменением Skills.");
      if (current.version !== expectedVersion)
        throw new ChatSkillError(
          409,
          "Skills чата изменены в другой вкладке. Загрузите сохранённый выбор."
        );
      const items = refs.map((ref) => {
        const row = this.sql
          .prepare(
            `SELECT skill_id,version,name,summary,instructions FROM owner_skill_versions
          WHERE skill_id=? AND version=? AND owner_id=?`
          )
          .get(ref.skill_id, ref.version, ownerId) as ChatSkillSnapshot | undefined;
        if (!row) throw new ChatSkillError(404, "Выбранный Skill или его версия недоступны.");
        return row;
      });
      if (new TextEncoder().encode(JSON.stringify(items)).length > CHAT_SKILLS_MAX_BYTES)
        throw new ChatSkillError(
          400,
          "Выбранные инструкции превышают общий размер 16 КБ. Сократите их или выберите меньше Skills."
        );
      this.sql
        .prepare(
          `INSERT INTO chat_skill_settings(chat_id,version,updated_at) VALUES(?,?,?)
        ON CONFLICT(chat_id) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at`
        )
        .run(chatId, current.version + 1, new Date().toISOString());
      this.sql.prepare("DELETE FROM chat_skill_selections WHERE chat_id=?").run(chatId);
      const insert = this.sql.prepare(
        "INSERT INTO chat_skill_selections(chat_id,skill_id,version,position) VALUES(?,?,?,?)"
      );
      items.forEach((item, i) => insert.run(chatId, item.skill_id, item.version, i));
      const result = this.get(chatId, ownerId);
      this.sql.exec("COMMIT");
      return result;
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
  /** Called only inside the same transaction that accepts the message and run. */
  snapshotRun(runId: string, chatId: string, ownerId: string): void {
    const selection = this.get(chatId, ownerId);
    const inserted = this.sql
      .prepare(
        `INSERT INTO chat_run_skill_snapshots(run_id,selection_version,skills_json)
      SELECT r.id,?,? FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id
      WHERE r.id=? AND r.chat_id=? AND c.owner_id=?`
      )
      .run(selection.version, JSON.stringify(selection.items), runId, chatId, ownerId);
    if (Number(inserted.changes) !== 1) throw new ChatSkillError(404, "Ответ не найден.");
  }
  forRun(
    runId: string,
    ownerId: string
  ): { selection_version: number; items: ChatSkillSnapshot[] } | null {
    const row = this.sql
      .prepare(
        `SELECT s.selection_version,s.skills_json FROM general_chat_runs r
      JOIN general_chats c ON c.id=r.chat_id LEFT JOIN chat_run_skill_snapshots s ON s.run_id=r.id
      WHERE r.id=? AND c.owner_id=?`
      )
      .get(runId, ownerId) as
      { selection_version: number | null; skills_json: string | null } | undefined;
    if (!row) return null;
    // Runs accepted before migration had no Skills. Never resolve their selection retroactively.
    return {
      selection_version: row.selection_version ?? 0,
      items: row.skills_json ? (JSON.parse(row.skills_json) as ChatSkillSnapshot[]) : []
    };
  }
  copy(sourceId: string, targetId: string, ownerId: string): void {
    this.assertChat(sourceId, ownerId);
    this.assertChat(targetId, ownerId);
    this.sql
      .prepare(
        `INSERT INTO chat_skill_settings(chat_id,version,updated_at)
      SELECT ?,version,updated_at FROM chat_skill_settings WHERE chat_id=?`
      )
      .run(targetId, sourceId);
    this.sql
      .prepare(
        `INSERT INTO chat_skill_selections(chat_id,skill_id,version,position)
      SELECT ?,skill_id,version,position FROM chat_skill_selections WHERE chat_id=?`
      )
      .run(targetId, sourceId);
  }
}
