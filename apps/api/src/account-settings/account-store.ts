import { randomBytes, randomUUID, createHash } from "node:crypto";
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
  /** Deliberately separate from the main Drizzle migration journal: integrator may apply SQL in its own migration. */
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
          `SELECT COALESCE(SUM(CASE WHEN u.status='committed' AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL THEN u.actual_input_tokens+u.actual_output_tokens ELSE u.estimated_input_tokens+u.max_output_tokens END),0) AS total FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?`
        )
        .get(owner)
    );
    const projects = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN u.status='committed' AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL THEN u.actual_input_tokens+u.actual_output_tokens ELSE u.estimated_input_tokens+u.max_output_tokens END),0) AS total FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?`
        )
        .get(owner)
    );
    const retained = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN status='committed' AND actual_input_tokens IS NOT NULL AND actual_output_tokens IS NOT NULL AND calculated_cost_amount IS NOT NULL AND currency IS NOT NULL THEN actual_input_tokens+actual_output_tokens ELSE estimated_input_tokens+max_output_tokens END),0) total FROM kosmora_retained_accounting WHERE owner_id=?`
        )
        .get(owner)
    );
    const aux = total(
      this.sqlite
        .prepare(
          `SELECT COALESCE(SUM(input_tokens+output_tokens),0) total FROM kosmora_auxiliary_model_usage WHERE owner_id=?`
        )
        .get(owner)
    );
    return general + projects + retained + aux;
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
      AND NOT EXISTS (SELECT 1 FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)
      AND NOT EXISTS (SELECT 1 FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=h.owner_id AND u.run_id=h.run_id AND u.attempt=h.attempt)
      AND NOT EXISTS (SELECT 1 FROM kosmora_auxiliary_model_usage a WHERE a.owner_id=h.owner_id AND a.run_id=h.run_id AND a.attempt=h.attempt)
      AND NOT EXISTS (SELECT 1 FROM kosmora_retained_accounting r WHERE r.owner_id=h.owner_id AND r.run_id=h.run_id AND r.attempt=h.attempt)
    `
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
      const fence = this.sqlite
        .prepare(
          "SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
        )
        .get(owner);
      if (fence) throw new Error("OWNER_DATA_FENCED");
      if (kind === "main") {
        const existing = this.sqlite
          .prepare(
            "SELECT id,owner_id,max_tokens FROM kosmora_usage_holds WHERE run_id=? AND attempt=?"
          )
          .get(runId, attempt) as { id: string; owner_id: string; max_tokens: number } | undefined;
        if (existing) {
          if (existing.owner_id !== owner || existing.max_tokens !== maxTokens)
            throw Error("RESERVATION_CONFLICT");
          this.sqlite.exec("COMMIT");
          return existing.id;
        }
      }
      const row = this.get(owner);
      const current = this.summary(owner);
      if (
        row.max_total_tokens !== null &&
        current.total_counted_tokens + maxTokens > row.max_total_tokens
      )
        throw new QuotaExceededError("Token budget would be exceeded");
      if (kind === "main") {
        const existing = this.sqlite
          .prepare(
            "SELECT id,owner_id,max_tokens FROM kosmora_usage_holds WHERE run_id=? AND attempt=?"
          )
          .get(runId, attempt) as { id: string; owner_id: string; max_tokens: number } | undefined;
        if (existing) {
          if (existing.owner_id !== owner || existing.max_tokens !== maxTokens)
            throw new Error("RESERVATION_CONFLICT");
          this.sqlite.exec("COMMIT");
          return existing.id;
        }
        this.sqlite
          .prepare(
            `INSERT INTO kosmora_usage_holds(id,owner_id,run_id,attempt,max_tokens,status,created_at) VALUES(?,?,?,?,?,'reserved',?)`
          )
          .run(id, owner, runId, attempt, maxTokens, now());
      } else
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
      // A caller cannot erase an unknown hold: require canonical usage first.
      const hold = this.sqlite
        .prepare("SELECT owner_id,run_id,attempt FROM kosmora_usage_holds WHERE id=?")
        .get(id) as { owner_id: string; run_id: string; attempt: number } | undefined;
      if (!hold) return;
      const canonical = this.sqlite
        .prepare(
          `SELECT 1 FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id
         WHERE c.owner_id=? AND u.run_id=? AND u.attempt=? AND u.status='committed' AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL
         UNION SELECT 1 FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id
         WHERE p.owner_id=? AND u.run_id=? AND u.attempt=? AND u.status='committed' AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL
         UNION SELECT 1 FROM kosmora_auxiliary_model_usage a WHERE a.owner_id=? AND a.run_id=? AND a.attempt=?`
        )
        .get(
          hold.owner_id,
          hold.run_id,
          hold.attempt,
          hold.owner_id,
          hold.run_id,
          hold.attempt,
          hold.owner_id,
          hold.run_id,
          hold.attempt
        );
      if (canonical) this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE id=?").run(id);
      else this.uncertainReservation(id, "main");
    } else {
      this.sqlite
        .prepare(
          `UPDATE kosmora_relay_usage SET status='committed',input_tokens=?,output_tokens=? WHERE id=? AND status='reserved'`
        )
        .run(input, output, id);
    }
  }
  /** On restart, settle only holds backed by fully verified canonical usage.
   * Unknown tokens/pricing and all other reservations remain counted at their upper bound. */
  reconcileKnownCanonicalHolds(): number {
    const result = this.sqlite
      .prepare(
        `DELETE FROM kosmora_usage_holds WHERE
      EXISTS (SELECT 1 FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id
        WHERE c.owner_id=kosmora_usage_holds.owner_id AND u.run_id=kosmora_usage_holds.run_id
        AND u.attempt=kosmora_usage_holds.attempt AND u.status='committed'
        AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL
        AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL)
      OR EXISTS (SELECT 1 FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id
        WHERE p.owner_id=kosmora_usage_holds.owner_id AND u.run_id=kosmora_usage_holds.run_id
        AND u.attempt=kosmora_usage_holds.attempt AND u.status='committed'
        AND u.actual_input_tokens IS NOT NULL AND u.actual_output_tokens IS NOT NULL
        AND u.calculated_cost_amount IS NOT NULL AND u.currency IS NOT NULL)
      OR EXISTS (SELECT 1 FROM kosmora_auxiliary_model_usage a
        WHERE a.owner_id=kosmora_usage_holds.owner_id AND a.run_id=kosmora_usage_holds.run_id
        AND a.attempt=kosmora_usage_holds.attempt AND a.cost_amount IS NOT NULL AND a.currency IS NOT NULL)
    `
      )
      .run();
    return Number(result.changes);
  }
  uncertainReservation(id: string, kind: "main" | "to_en" | "from_en"): void {
    if (kind === "main")
      this.sqlite.prepare(`UPDATE kosmora_usage_holds SET status='uncertain' WHERE id=?`).run(id);
    else
      this.sqlite.prepare(`UPDATE kosmora_relay_usage SET status='uncertain' WHERE id=?`).run(id);
  }
  /** Caller proves gateway iterator is still paused at route.selected; only local failures qualify. */
  releaseBeforeDispatch(id: string): void {
    this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE id=? AND status='reserved'").run(id);
  }
  /** Independent document answers have canonical owner-scoped accounting, not a fake chat ledger. */
  completeAuxiliary(
    owner: string,
    runId: string,
    attempt: number,
    kind: "document",
    provider: string,
    model: string,
    input: number,
    output: number,
    cost: number | null,
    currency: string | null
  ): void {
    if (
      !Number.isSafeInteger(input) ||
      input < 0 ||
      !Number.isSafeInteger(output) ||
      output < 0 ||
      cost === null ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      !currency
    )
      throw Error("CANONICAL_USAGE_UNAVAILABLE");
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const h = this.sqlite
        .prepare("SELECT id FROM kosmora_usage_holds WHERE owner_id=? AND run_id=? AND attempt=?")
        .get(owner, runId, attempt) as { id: string } | undefined;
      const prior = this.sqlite
        .prepare(
          "SELECT 1 FROM kosmora_auxiliary_model_usage WHERE owner_id=? AND run_id=? AND attempt=?"
        )
        .get(owner, runId, attempt);
      if (!h && !prior) throw Error("RESERVATION_MISSING");
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_auxiliary_model_usage(owner_id,run_id,attempt,kind,provider_id,model_id,input_tokens,output_tokens,cost_amount,currency,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,run_id,attempt) DO NOTHING`
        )
        .run(owner, runId, attempt, kind, provider, model, input, output, cost, currency, now());
      if (h) this.sqlite.prepare("DELETE FROM kosmora_usage_holds WHERE id=?").run(h.id);
      this.sqlite.exec("COMMIT");
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  usage(owner: string, limit = 150) {
    const cap = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.sqlite
      .prepare(
        `SELECT 'chat' kind,u.chat_id chat_id,u.run_id,u.provider_id,u.model_requested model_id,u.status,u.actual_input_tokens input_tokens,u.actual_output_tokens output_tokens,u.estimated_input_tokens+u.max_output_tokens reserved_tokens,u.calculated_cost_amount cost_amount,u.currency,u.created_at,NULL stage FROM general_chat_model_usage u JOIN general_chats c ON c.id=u.chat_id WHERE c.owner_id=?
      UNION ALL SELECT 'project',p.id,u.run_id,u.provider_id,u.model_requested,u.status,u.actual_input_tokens,u.actual_output_tokens,u.estimated_input_tokens+u.max_output_tokens,u.calculated_cost_amount,u.currency,u.created_at,NULL stage FROM model_usage_ledger u JOIN projects p ON p.id=u.project_id WHERE p.owner_id=?
      UNION ALL SELECT 'translation',chat_id,run_id,provider_id,model_id,status,input_tokens,output_tokens,reserved_tokens,NULL,NULL,created_at,stage FROM kosmora_relay_usage WHERE owner_id=?
      UNION ALL SELECT 'retained-' || source,NULL,run_id,provider_id,model_requested,status,actual_input_tokens,actual_output_tokens,estimated_input_tokens+max_output_tokens,calculated_cost_amount,currency,created_at,NULL FROM kosmora_retained_accounting WHERE owner_id=?
      UNION ALL SELECT kind,NULL,run_id,provider_id,model_id,'committed',input_tokens,output_tokens,input_tokens+output_tokens,cost_amount,currency,created_at,NULL FROM kosmora_auxiliary_model_usage WHERE owner_id=?
      ORDER BY created_at DESC LIMIT ?`
      )
      .all(owner, owner, owner, owner, owner, cap);
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
  /** Disabled: direct chat/project cascades previously destroyed accounting and ignored adjacent stores. */
  deleteData(_owner: string, _token: string, _phrase: string): never {
    void _owner;
    void _token;
    void _phrase;
    throw new Error("Use OwnerPrivacyCoordinator with all mandatory adapters and quiesce");
  }
}
