import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { ACCOUNT_MIGRATION_SQL } from "./migration.js";
import type { DatabaseSync } from "node:sqlite";

export type OptimizeFor = "balanced" | "quality" | "latency" | "cost";
export type AccountPreferences = {
  version: number;
  relay_enabled: boolean;
  response_language: "ru" | "en";
  optimize_for: OptimizeFor;
  preferred_provider: string | null;
  preferred_model: string | null;
  chat_style: "standard" | "concise" | "detailed";
  max_total_tokens: number | null;
  updated_at: string | null;
};
export type PreferenceUpdate = Omit<AccountPreferences, "version" | "updated_at"> & {
  expected_version: number;
};
type RecordRow = Record<string, unknown>;
const now = () => new Date().toISOString();
const defaults: AccountPreferences = {
  version: 0,
  relay_enabled: false,
  response_language: "ru",
  optimize_for: "balanced",
  preferred_provider: null,
  preferred_model: null,
  chat_style: "standard",
  max_total_tokens: null,
  updated_at: null
};
export class PreferenceConflictError extends Error {}
export class QuotaExceededError extends Error {
  readonly code = "USAGE_LIMIT_EXCEEDED";
}
const total = (row: unknown): number => Number((row as { total: number }).total ?? 0);
const boundedLimit = (value: number | null): void => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 2_000_000_000))
    throw new Error("Invalid token quota");
};

export class AccountStore {
  constructor(readonly sqlite: DatabaseSync) {}
  /** Test-fixture helper. Production schema is applied by canonical migration 0027. */
  migrate(): void {
    this.sqlite.exec(ACCOUNT_MIGRATION_SQL);
  }
  get(owner: string): AccountPreferences {
    const row = this.sqlite
      .prepare("SELECT * FROM kosmora_account_preferences WHERE owner_id=?")
      .get(owner) as RecordRow | undefined;
    return row
      ? {
          version: Number(row.version),
          relay_enabled: Boolean(row.relay_enabled),
          response_language: row.response_language as "ru" | "en",
          optimize_for: row.optimize_for as OptimizeFor,
          preferred_provider: row.preferred_provider as string | null,
          preferred_model: row.preferred_model as string | null,
          chat_style: row.chat_style as AccountPreferences["chat_style"],
          max_total_tokens: row.max_total_tokens as number | null,
          updated_at: row.updated_at as string
        }
      : { ...defaults };
  }
  update(owner: string, next: PreferenceUpdate): AccountPreferences {
    boundedLimit(next.max_total_tokens);
    if (
      !["ru", "en"].includes(next.response_language) ||
      !["balanced", "quality", "latency", "cost"].includes(next.optimize_for) ||
      !["standard", "concise", "detailed"].includes(next.chat_style) ||
      typeof next.relay_enabled !== "boolean" ||
      !Number.isSafeInteger(next.expected_version)
    )
      throw new Error("Invalid preferences");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(owner);
      if (current.version !== next.expected_version)
        throw new PreferenceConflictError("Settings were changed elsewhere");
      const insert = this.sqlite
        .prepare(`INSERT INTO kosmora_account_preferences (owner_id,version,relay_enabled,response_language,optimize_for,preferred_provider,preferred_model,chat_style,max_total_tokens,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET version=excluded.version,relay_enabled=excluded.relay_enabled,response_language=excluded.response_language,optimize_for=excluded.optimize_for,preferred_provider=excluded.preferred_provider,preferred_model=excluded.preferred_model,chat_style=excluded.chat_style,max_total_tokens=excluded.max_total_tokens,updated_at=excluded.updated_at`);
      insert.run(
        owner,
        current.version + 1,
        Number(next.relay_enabled),
        next.response_language,
        next.optimize_for,
        next.preferred_provider,
        next.preferred_model,
        next.chat_style,
        next.max_total_tokens,
        now()
      );
      this.sqlite.exec("COMMIT");
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
    return this.get(owner);
  }
  getRelay(owner: string, chatId: string): boolean {
    const row = this.sqlite
      .prepare(
        `SELECT p.relay_enabled FROM kosmora_chat_preferences p JOIN general_chats c ON c.id=p.chat_id AND c.owner_id=p.owner_id WHERE p.owner_id=? AND p.chat_id=?`
      )
      .get(owner, chatId) as { relay_enabled: number } | undefined;
    return row ? Boolean(row.relay_enabled) : this.get(owner).relay_enabled;
  }
  chatRelayOverride(owner: string, chatId: string): boolean | null {
    const row = this.sqlite
      .prepare(
        `SELECT p.relay_enabled FROM kosmora_chat_preferences p JOIN general_chats c ON c.id=p.chat_id WHERE c.owner_id=? AND p.chat_id=?`
      )
      .get(owner, chatId) as { relay_enabled: number } | undefined;
    return row ? Boolean(row.relay_enabled) : null;
  }
  setChatRelay(owner: string, chatId: string, enabled: boolean | null): void {
    if (
      !this.sqlite
        .prepare("SELECT 1 FROM general_chats WHERE id=? AND owner_id=?")
        .get(chatId, owner)
    )
      throw new Error("Chat not found");
    if (enabled === null)
      this.sqlite
        .prepare("DELETE FROM kosmora_chat_preferences WHERE owner_id=? AND chat_id=?")
        .run(owner, chatId);
    else
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_chat_preferences(chat_id,owner_id,relay_enabled) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET relay_enabled=excluded.relay_enabled`
        )
        .run(chatId, owner, Number(enabled));
  }
  private legacyTokens(owner: string): number {
    // Previous failed/cancelled/reserved attempts may have been charged. Count their upper bounds.
    const general = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN u.status='committed' THEN COALESCE(u.actual_input_tokens,u.estimated_input_tokens)+COALESCE(u.actual_output_tokens,u.max_output_tokens) ELSE u.estimated_input_tokens+u.max_output_tokens END),0) AS total FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?`
        )
        .get(owner)
    );
    const projects = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN u.status='committed' THEN COALESCE(u.actual_input_tokens,u.estimated_input_tokens)+COALESCE(u.actual_output_tokens,u.max_output_tokens) ELSE u.estimated_input_tokens+u.max_output_tokens END),0) AS total FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?`
        )
        .get(owner)
    );
    return general + projects;
  }
  summary(owner: string) {
    const historic = this.legacyTokens(owner);
    const relay = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN status='committed' THEN COALESCE(input_tokens,reserved_tokens)+COALESCE(output_tokens,0) ELSE reserved_tokens END),0) total FROM kosmora_relay_usage WHERE owner_id=?`
        )
        .get(owner)
    );
    const holds = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(h.max_tokens),0) total FROM kosmora_usage_holds h WHERE h.owner_id=?
            AND NOT EXISTS (SELECT 1 FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id
              WHERE c.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)
            AND NOT EXISTS (SELECT 1 FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id
              WHERE p.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)`
        )
        .get(owner)
    );
    return {
      model_tokens_or_upper_bound: historic,
      translation_tokens_or_upper_bound: relay,
      in_flight_or_uncertain_holds: holds,
      total_counted_tokens: historic + relay + holds,
      max_total_tokens: this.get(owner).max_total_tokens,
      currency_cost: "unknown" as const
    };
  }
  reserve(
    owner: string,
    runId: string,
    attempt: number,
    maxTokens: number,
    kind: "main" | "to_en" | "from_en",
    chatId: string,
    provider: string,
    model: string
  ): string {
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error("Invalid reservation");
    const id = randomUUID();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const row = this.get(owner);
      const current = this.summary(owner);
      if (
        row.max_total_tokens !== null &&
        current.total_counted_tokens + maxTokens > row.max_total_tokens
      )
        throw new QuotaExceededError("Token budget would be exceeded");
      if (kind === "main")
        this.sqlite
          .prepare(
            `INSERT INTO kosmora_usage_holds(id,owner_id,run_id,attempt,max_tokens,status,created_at) VALUES(?,?,?,?,?,'reserved',?)`
          )
          .run(id, owner, runId, attempt, maxTokens, now());
      else
        this.sqlite
          .prepare(
            `INSERT INTO kosmora_relay_usage(id,owner_id,chat_id,run_id,stage,attempt,provider_id,model_id,status,reserved_tokens,created_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?)`
          )
          .run(id, owner, chatId, runId, kind, attempt, provider, model, maxTokens, now());
      this.sqlite.exec("COMMIT");
      return id;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  completeReservation(
    id: string,
    kind: "main" | "to_en" | "from_en",
    input: number | null,
    output: number | null
  ): void {
    if (kind === "main") {
      // Existing canonical run ledger is committed by the chat runtime. Only release after it commits.
      this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE id=?").run(id);
    } else {
      this.sqlite
        .prepare(
          `UPDATE kosmora_relay_usage SET status='committed',input_tokens=?,output_tokens=? WHERE id=? AND status='reserved'`
        )
        .run(input, output, id);
    }
  }
  uncertainReservation(id: string, kind: "main" | "to_en" | "from_en"): void {
    if (kind === "main")
      this.sqlite.prepare(`UPDATE kosmora_usage_holds SET status='uncertain' WHERE id=?`).run(id);
    else
      this.sqlite.prepare(`UPDATE kosmora_relay_usage SET status='uncertain' WHERE id=?`).run(id);
  }
  /** Caller must still be handling route.selected, before resuming gateway iteration.
   * Only a proven local pre-dispatch rejection may release a reserved main hold. */
  releaseBeforeDispatch(id: string): void {
    this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE id=? AND status='reserved'").run(id);
  }
  usage(owner: string, limit = 150) {
    const cap = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.sqlite
      .prepare(
        `SELECT 'chat' kind,u.chat_id chat_id,u.run_id,u.provider_id,u.model_requested model_id,u.status,u.actual_input_tokens input_tokens,u.actual_output_tokens output_tokens,u.estimated_input_tokens+u.max_output_tokens reserved_tokens,u.calculated_cost_amount cost_amount,u.currency,u.created_at,NULL stage FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?
      UNION ALL SELECT 'project',p.id,u.run_id,u.provider_id,u.model_requested,u.status,u.actual_input_tokens,u.actual_output_tokens,u.estimated_input_tokens+u.max_output_tokens,u.calculated_cost_amount,u.currency,u.created_at,NULL stage FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?
      UNION ALL SELECT 'translation',chat_id,run_id,provider_id,model_id,status,input_tokens,output_tokens,reserved_tokens,NULL,NULL,created_at,stage FROM kosmora_relay_usage WHERE owner_id=?
      ORDER BY created_at DESC LIMIT ?`
      )
      .all(owner, owner, owner, cap);
    return { summary: this.summary(owner), rows };
  }
  exportData(owner: string) {
    // Full owner-scoped rows from known application tables, with no truncation.
    // Auth sessions and immutable operational security audits are purposefully excluded.
    const query = (sql: string) => this.sqlite.prepare(sql).all(owner);
    return {
      format: "kosmora-account-export-v1",
      created_at: now(),
      preferences: this.get(owner),
      chat_preferences: query(
        "SELECT p.chat_id,p.relay_enabled FROM kosmora_chat_preferences p JOIN general_chats c ON c.id=p.chat_id WHERE c.owner_id=?"
      ),
      chats: query("SELECT * FROM general_chats WHERE owner_id=?"),
      chat_messages: query(
        "SELECT m.* FROM general_chat_messages m JOIN general_chats c ON c.id=m.chat_id WHERE c.owner_id=?"
      ),
      chat_runs: query(
        "SELECT r.* FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id WHERE c.owner_id=?"
      ),
      chat_usage: query(
        "SELECT u.* FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?"
      ),
      projects: query("SELECT * FROM projects WHERE owner_id=?"),
      project_chats: query(
        "SELECT c.* FROM chats c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=?"
      ),
      project_messages: query(
        "SELECT m.* FROM messages m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=?"
      ),
      project_runs: query(
        "SELECT r.* FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=?"
      ),
      project_usage: query(
        "SELECT u.* FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?"
      ),
      project_materials: query(
        "SELECT m.* FROM project_materials m JOIN projects p ON p.id=m.project_id WHERE p.owner_id=?"
      ),
      manager_work: query(
        "SELECT w.* FROM manager_work w JOIN projects p ON p.id=w.project_id WHERE p.owner_id=?"
      ),
      manager_work_files: query(
        "SELECT f.* FROM manager_work_files f JOIN manager_work w ON w.id=f.execution_id WHERE w.owner_id=?"
      ),
      github_change_drafts: query("SELECT * FROM github_change_drafts WHERE owner_id=?"),
      relay_usage: query("SELECT * FROM kosmora_relay_usage WHERE owner_id=?"),
      usage_holds: query("SELECT * FROM kosmora_usage_holds WHERE owner_id=?"),
      note: "Authentication sessions, immutable security audits, and unrelated external provider data are not included."
    };
  }
  createDeleteChallenge(owner: string) {
    const token = randomBytes(24).toString("base64url");
    const digest = createHash("sha256").update(token).digest("hex");
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_data_delete_challenges(owner_id,digest,expires_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at`
      )
      .run(owner, digest, new Date(Date.now() + 5 * 60_000).toISOString());
    return {
      confirmation_token: token,
      expires_in_seconds: 300,
      required_phrase: "УДАЛИТЬ МОИ ДАННЫЕ"
    };
  }
  deleteData(owner: string, token: string, phrase: string): void {
    if (phrase !== "УДАЛИТЬ МОИ ДАННЫЕ" || typeof token !== "string" || token.length > 128)
      throw new Error("Explicit deletion confirmation required");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const row = this.sqlite
        .prepare("SELECT digest,expires_at FROM kosmora_data_delete_challenges WHERE owner_id=?")
        .get(owner) as { digest: string; expires_at: string } | undefined;
      const digest = createHash("sha256").update(token).digest();
      if (
        !row ||
        Date.parse(row.expires_at) <= Date.now() ||
        !timingSafeEqual(Buffer.from(row.digest, "hex"), digest)
      )
        throw new Error("Invalid or expired deletion confirmation");
      if (
        this.sqlite
          .prepare(
            `SELECT 1 FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id WHERE c.owner_id=? AND r.status IN ('queued','running') LIMIT 1`
          )
          .get(owner) ||
        this.sqlite
          .prepare(
            `SELECT 1 FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=? AND r.status IN ('QUEUED','RUNNING') LIMIT 1`
          )
          .get(owner)
      )
        throw new Error("Active runs must finish or be cancelled before deletion");
      this.sqlite.prepare("DELETE FROM kosmora_data_delete_challenges WHERE owner_id=?").run(owner);
      this.sqlite.prepare("DELETE FROM kosmora_account_preferences WHERE owner_id=?").run(owner);
      this.sqlite.prepare("DELETE FROM kosmora_relay_usage WHERE owner_id=?").run(owner);
      this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE owner_id=?").run(owner);
      this.sqlite.prepare("DELETE FROM general_chats WHERE owner_id=?").run(owner);
      this.sqlite.prepare("DELETE FROM projects WHERE owner_id=?").run(owner);
      this.sqlite.exec("COMMIT");
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
}
