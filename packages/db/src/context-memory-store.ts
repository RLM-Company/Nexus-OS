import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Value } from "typebox/value";
import { memoryContainsCredential } from "./context-memory-sensitive.js";
import {
  ContextMemoryInputSchema,
  ContextMemorySettingsInputSchema,
  MemoryTargetSchema,
  type ContextMemoryBundle,
  type ContextMemoryEntry,
  type ContextMemoryEvidence,
  type ContextMemoryInput,
  type ContextMemorySettings,
  type ContextMemorySettingsInput,
  type ContextMemorySource,
  type MemoryTarget
} from "@cosmora/contracts";

export class ContextMemoryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string
  ) {
    super(code);
  }
}
type Row = {
  id: string;
  owner_id: string;
  scope: ContextMemoryInput["scope"];
  chat_id: string | null;
  project_id: string | null;
  kind: ContextMemoryInput["kind"];
  title: string;
  content: string;
  pinned: number;
  expires_at: string | null;
  source_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
type SourceMessage = {
  id: string;
  chat_id: string;
  project_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const words = (s: string) =>
  [
    ...new Set(
      s
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    )
  ]
    .filter((s) => (s.length >= 3 || /^\d+$/.test(s)) && !STOP.has(s))
    .slice(0, 12);
const STOP = new Set([
  "the",
  "and",
  "for",
  "this",
  "that",
  "with",
  "from",
  "have",
  "what",
  "please",
  "как",
  "что",
  "это",
  "для",
  "или",
  "мне",
  "мой",
  "моя",
  "меня",
  "тебе",
  "тебя",
  "пожалуйста",
  "давай",
  "сделай",
  "можешь",
  "быть",
  "будет"
]);
const EMPTY_SETTINGS: ContextMemorySettings = {
  compact_history: false,
  enabled: false,
  use_personal: false,
  source_chat_ids: [],
  project_ids: [],
  version: 0
};

/** Explicit, source-backed memory. No automatic extraction, embedding service or provider calls. */
export class ContextMemoryStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now = () => Date.now()
  ) {}

  private active(owner: string) {
    if (
      this.db
        .prepare("SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'")
        .get(owner)
    )
      throw new ContextMemoryError(409, "OWNER_DATA_FENCED");
  }
  private idle(owner: string) {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM general_chat_runs r JOIN general_chats c ON c.id=r.chat_id WHERE c.owner_id=? AND r.status IN ('queued','running') " +
            "UNION ALL SELECT 1 FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=? AND lower(r.status) IN ('queued','running') " +
            "UNION ALL SELECT 1 FROM manager_work WHERE owner_id=? AND json_extract(state_json,'$.status') IN ('queued','running') LIMIT 1"
        )
        .get(owner, owner, owner)
    )
      throw new ContextMemoryError(409, "MEMORY_RUN_ACTIVE");
  }
  private owned(target: MemoryTarget, owner: string, active = false) {
    if (!Value.Check(MemoryTargetSchema, target))
      throw new ContextMemoryError(400, "INVALID_MEMORY_TARGET");
    const row =
      target.kind === "chat"
        ? this.db
            .prepare(
              "SELECT 1 FROM general_chats WHERE id=? AND owner_id=?" +
                (active ? " AND archived=0" : "")
            )
            .get(target.id, owner)
        : this.db
            .prepare(
              "SELECT 1 FROM projects WHERE id=? AND owner_id=?" +
                (active ? " AND status='ACTIVE'" : "")
            )
            .get(target.id, owner);
    if (!row) throw new ContextMemoryError(404, "MEMORY_TARGET_NOT_FOUND");
  }
  private transaction<T>(owner: string, operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.active(owner);
      this.idle(owner);
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private message(
    kind: ContextMemorySource["kind"],
    id: string,
    owner: string
  ): SourceMessage | null {
    this.active(owner);
    const row = (
      kind === "chat_message"
        ? this.db
            .prepare(
              "SELECT m.id,m.chat_id,NULL project_id,m.role,m.content,m.created_at,s.excluded_json FROM general_chat_messages m " +
                "JOIN general_chats c ON c.id=m.chat_id AND c.owner_id=m.owner_id " +
                "LEFT JOIN chat_context_settings s ON s.chat_id=c.id " +
                "WHERE m.id=? AND c.owner_id=? AND c.archived=0 AND m.status='completed' AND m.role IN ('user','assistant')"
            )
            .get(id, owner)
        : this.db
            .prepare(
              "SELECT m.id,m.chat_id,m.project_id,m.role,m.content,m.created_at,NULL excluded_json FROM messages m " +
                "JOIN projects p ON p.id=m.project_id JOIN chats c ON c.id=m.chat_id AND c.project_id=p.id " +
                "WHERE m.id=? AND p.owner_id=? AND p.status='ACTIVE' AND m.status='completed' AND m.role IN ('user','assistant')"
            )
            .get(id, owner)
    ) as (SourceMessage & { excluded_json: string | null }) | undefined;
    if (
      !row ||
      memoryContainsCredential(row.content) ||
      (row.excluded_json && (JSON.parse(row.excluded_json) as string[]).includes(id))
    )
      return null;
    return {
      id: row.id,
      chat_id: row.chat_id,
      project_id: row.project_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at
    };
  }
  private source(input: ContextMemoryInput["source"], owner: string): ContextMemorySource | null {
    if (!input) return null;
    const message = this.message(input.kind, input.message_id, owner);
    if (!message || !message.content.includes(input.quote))
      throw new ContextMemoryError(400, "MEMORY_SOURCE_NOT_FOUND");
    return {
      ...input,
      chat_id: message.chat_id,
      project_id: message.project_id,
      role: message.role,
      sha256: hash(message.content)
    };
  }
  private cachedMessage(
    kind: ContextMemorySource["kind"],
    id: string,
    owner: string,
    cache: Map<string, SourceMessage | null>
  ) {
    const key = kind + ":" + id;
    if (!cache.has(key)) cache.set(key, this.message(kind, id, owner));
    return cache.get(key) ?? null;
  }
  private matches(source: ContextMemorySource, message: SourceMessage) {
    return (
      hash(message.content) === source.sha256 &&
      source.role === message.role &&
      source.chat_id === message.chat_id &&
      source.project_id === message.project_id
    );
  }
  private decode(row: Row, cache = new Map<string, SourceMessage | null>()): ContextMemoryEntry {
    const source = row.source_json ? (JSON.parse(row.source_json) as ContextMemorySource) : null;
    const message = source
      ? this.cachedMessage(source.kind, source.message_id, row.owner_id, cache)
      : null;
    return {
      id: row.id,
      scope: row.scope,
      scope_id: row.chat_id ?? row.project_id,
      kind: row.kind,
      title: row.title,
      content: row.content,
      pinned: Boolean(row.pinned),
      expires_at: row.expires_at,
      version: row.version,
      source,
      source_status: !source
        ? "manual"
        : !message
          ? "unavailable"
          : this.matches(source, message)
            ? "current"
            : "changed",
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
  get(id: string, owner: string): ContextMemoryEntry | null {
    this.active(owner);
    const row = this.db
      .prepare("SELECT * FROM context_memory_entries WHERE id=? AND owner_id=?")
      .get(id, owner) as Row | undefined;
    return row ? this.decode(row) : null;
  }
  list(owner: string, offset = 0, query = "") {
    this.active(owner);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || query.length > 160)
      throw new ContextMemoryError(400, "INVALID_MEMORY_QUERY");
    const needle = query.normalize("NFKC").toLocaleLowerCase();
    const rows = (
      this.db
        .prepare(
          "SELECT * FROM context_memory_entries WHERE owner_id=? ORDER BY pinned DESC,updated_at DESC,id LIMIT 1000"
        )
        .all(owner) as Row[]
    )
      .filter((r) =>
        (r.title + "\n" + r.content).normalize("NFKC").toLocaleLowerCase().includes(needle)
      )
      .slice(offset, offset + 51);
    return {
      items: rows.slice(0, 50).map((r) => this.decode(r)),
      next_offset: rows.length > 50 ? offset + 50 : null
    };
  }
  private validate(input: ContextMemoryInput, owner: string) {
    if (
      !Value.Check(ContextMemoryInputSchema, input) ||
      (input.scope === "personal") !== (input.scope_id === null) ||
      (input.expires_at !== null &&
        (!Number.isFinite(Date.parse(input.expires_at)) ||
          Date.parse(input.expires_at) <= this.now()))
    )
      throw new ContextMemoryError(400, "INVALID_MEMORY");
    if (
      memoryContainsCredential(
        input.title + "\n" + input.content + "\n" + (input.source?.quote ?? "")
      )
    )
      throw new ContextMemoryError(400, "MEMORY_SECRET_UNSUPPORTED");
    if (input.scope !== "personal")
      this.owned({ kind: input.scope, id: input.scope_id! }, owner, true);
  }
  private revision(id: string, owner: string) {
    const entry = this.get(id, owner)!;
    this.db
      .prepare("INSERT INTO context_memory_versions(entry_id,version,snapshot_json) VALUES(?,?,?)")
      .run(id, entry.version, JSON.stringify(entry));
    return entry;
  }
  create(input: ContextMemoryInput, owner: string, creationKey?: string) {
    return this.transaction(owner, () => {
      if (creationKey !== undefined && (!creationKey.trim() || creationKey.length > 128))
        throw new ContextMemoryError(400, "INVALID_MEMORY");
      const creationHash = hash(
        JSON.stringify([
          input.scope,
          input.scope_id,
          input.kind,
          input.title,
          input.content,
          input.pinned,
          input.expires_at,
          input.source?.kind ?? null,
          input.source?.message_id ?? null,
          input.source?.quote ?? null
        ])
      );
      if (creationKey) {
        const prior = this.db
          .prepare(
            "SELECT id,creation_sha256 FROM context_memory_entries WHERE owner_id=? AND creation_key=?"
          )
          .get(owner, creationKey) as { id: string; creation_sha256: string } | undefined;
        if (prior) {
          if (prior.creation_sha256 !== creationHash)
            throw new ContextMemoryError(409, "MEMORY_CREATION_CONFLICT");
          return this.get(prior.id, owner)!;
        }
      }
      this.validate(input, owner);
      const count = this.db
        .prepare("SELECT count(*) n FROM context_memory_entries WHERE owner_id=?")
        .get(owner) as { n: number };
      if (count.n >= 1000) throw new ContextMemoryError(409, "MEMORY_LIMIT");
      const source = this.source(input.source, owner);
      const id = randomUUID(),
        at = new Date(this.now()).toISOString();
      this.db
        .prepare(
          "INSERT INTO context_memory_entries(id,owner_id,scope,chat_id,project_id,kind,title,content,pinned,expires_at," +
            "source_chat_message_id,source_project_message_id,source_json,version,created_at,updated_at,creation_key,creation_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)"
        )
        .run(
          id,
          owner,
          input.scope,
          input.scope === "chat" ? input.scope_id : null,
          input.scope === "project" ? input.scope_id : null,
          input.kind,
          input.title,
          input.content,
          Number(input.pinned),
          input.expires_at,
          source?.kind === "chat_message" ? source.message_id : null,
          source?.kind === "project_message" ? source.message_id : null,
          source ? JSON.stringify(source) : null,
          at,
          at,
          creationKey ?? null,
          creationKey ? creationHash : null
        );
      return this.revision(id, owner);
    });
  }
  update(id: string, expectedVersion: number, input: ContextMemoryInput, owner: string) {
    return this.transaction(owner, () => {
      const old = this.get(id, owner);
      if (!old) throw new ContextMemoryError(404, "MEMORY_NOT_FOUND");
      if (
        old.version !== expectedVersion ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion >= 1_000_000
      )
        throw new ContextMemoryError(409, "STALE_MEMORY");
      this.validate(input, owner);
      const source = this.source(input.source, owner);
      this.db
        .prepare(
          "UPDATE context_memory_entries SET scope=?,chat_id=?,project_id=?,kind=?,title=?,content=?,pinned=?,expires_at=?," +
            "source_chat_message_id=?,source_project_message_id=?,source_json=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?"
        )
        .run(
          input.scope,
          input.scope === "chat" ? input.scope_id : null,
          input.scope === "project" ? input.scope_id : null,
          input.kind,
          input.title,
          input.content,
          Number(input.pinned),
          input.expires_at,
          source?.kind === "chat_message" ? source.message_id : null,
          source?.kind === "project_message" ? source.message_id : null,
          source ? JSON.stringify(source) : null,
          new Date(this.now()).toISOString(),
          id,
          owner,
          expectedVersion
        );
      return this.revision(id, owner);
    });
  }
  forget(id: string, version: number, owner: string) {
    return this.transaction(owner, () => {
      if (!this.get(id, owner)) throw new ContextMemoryError(404, "MEMORY_NOT_FOUND");
      if (
        !this.db
          .prepare("DELETE FROM context_memory_entries WHERE id=? AND owner_id=? AND version=?")
          .run(id, owner, version).changes
      )
        throw new ContextMemoryError(409, "STALE_MEMORY");
      // FK cascade removes ALL revisions; canonical source messages deliberately remain.
      return { forgotten: true as const, original_messages_deleted: false as const };
    });
  }
  versions(id: string, owner: string) {
    if (!this.get(id, owner)) throw new ContextMemoryError(404, "MEMORY_NOT_FOUND");
    return (
      this.db
        .prepare(
          "SELECT snapshot_json FROM context_memory_versions WHERE entry_id=? ORDER BY version DESC LIMIT 100"
        )
        .all(id) as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json) as ContextMemoryEntry);
  }
  settings(target: MemoryTarget, owner: string): ContextMemorySettings {
    this.active(owner);
    this.owned(target, owner);
    const row = this.db
      .prepare(
        "SELECT enabled,use_personal,compact_history,source_chat_ids_json,project_ids_json,version FROM context_memory_settings WHERE owner_id=? AND target_kind=? AND target_id=?"
      )
      .get(owner, target.kind, target.id) as
      | {
          enabled: number;
          compact_history: number;
          use_personal: number;
          source_chat_ids_json: string;
          project_ids_json: string;
          version: number;
        }
      | undefined;
    return row
      ? {
          enabled: Boolean(row.enabled),
          compact_history: Boolean(row.compact_history),
          use_personal: Boolean(row.use_personal),
          source_chat_ids: JSON.parse(row.source_chat_ids_json) as string[],
          project_ids: JSON.parse(row.project_ids_json) as string[],
          version: row.version
        }
      : { ...EMPTY_SETTINGS, source_chat_ids: [], project_ids: [] };
  }
  updateSettings(target: MemoryTarget, input: ContextMemorySettingsInput, owner: string) {
    return this.transaction(owner, () => {
      if (!Value.Check(ContextMemorySettingsInputSchema, input))
        throw new ContextMemoryError(400, "INVALID_MEMORY_SETTINGS");
      this.owned(target, owner, true);
      const current = this.settings(target, owner);
      if (target.kind !== "chat" && input.compact_history)
        throw new ContextMemoryError(400, "COMPACTION_CHAT_ONLY");
      if (current.version !== input.expected_version || input.expected_version >= 1_000_000)
        throw new ContextMemoryError(409, "STALE_MEMORY_SETTINGS");
      for (const id of input.source_chat_ids) this.owned({ kind: "chat", id }, owner, true);
      for (const id of input.project_ids) this.owned({ kind: "project", id }, owner, true);
      this.db
        .prepare(
          "INSERT INTO context_memory_settings(owner_id,target_kind,target_id,chat_id,project_id,enabled,use_personal,source_chat_ids_json,project_ids_json,version,compact_history) " +
            "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,target_kind,target_id) DO UPDATE SET enabled=excluded.enabled,use_personal=excluded.use_personal," +
            "source_chat_ids_json=excluded.source_chat_ids_json,project_ids_json=excluded.project_ids_json,version=excluded.version,compact_history=excluded.compact_history"
        )
        .run(
          owner,
          target.kind,
          target.id,
          target.kind === "chat" ? target.id : null,
          target.kind === "project" ? target.id : null,
          Number(input.enabled),
          Number(input.use_personal),
          JSON.stringify(input.source_chat_ids),
          JSON.stringify(input.project_ids),
          current.version + 1,
          Number(input.compact_history ?? current.compact_history)
        );
      return this.settings(target, owner);
    });
  }
  private grants(target: MemoryTarget, settings: ContextMemorySettings, owner: string) {
    const isActive = (kind: MemoryTarget["kind"], id: string) => {
      try {
        this.owned({ kind, id }, owner, true);
        return true;
      } catch (error) {
        if (error instanceof ContextMemoryError && error.status === 404) return false;
        throw error;
      }
    };
    return {
      chats: [
        ...new Set([...(target.kind === "chat" ? [target.id] : []), ...settings.source_chat_ids])
      ].filter((id) => isActive("chat", id)),
      projects: [
        ...new Set([...(target.kind === "project" ? [target.id] : []), ...settings.project_ids])
      ].filter((id) => isActive("project", id))
    };
  }
  private allowed(
    entry: ContextMemoryEntry,
    settings: ContextMemorySettings,
    grants: ReturnType<ContextMemoryStore["grants"]>
  ) {
    return (
      (entry.scope === "personal"
        ? settings.use_personal
        : entry.scope === "chat"
          ? grants.chats.includes(entry.scope_id!)
          : grants.projects.includes(entry.scope_id!)) &&
      (!entry.expires_at || Date.parse(entry.expires_at) > this.now()) &&
      (entry.source_status === "manual" || entry.source_status === "current")
    );
  }
  resolve(
    target: MemoryTarget,
    owner: string,
    query: string,
    excludeMessageIds: readonly string[] = [],
    budget = 6000
  ): ContextMemoryBundle {
    if (query.length > 400_000 || !Number.isInteger(budget) || budget < 1000 || budget > 12000)
      throw new ContextMemoryError(400, "INVALID_MEMORY_QUERY");
    const settings = this.settings(target, owner);
    const bundle: ContextMemoryBundle = {
      format: "kosmora.context-memory.v1",
      target,
      items: [],
      omitted: 0,
      priority_omitted: 0,
      bytes: 0,
      budget_bytes: budget,
      retrieval: "lexical"
    };
    if (!settings.enabled) return this.measure(bundle);
    this.owned(target, owner, true);
    const grants = this.grants(target, settings, owner),
      terms = words(query);
    const excluded = new Set(excludeMessageIds);
    const rows = this.db
      .prepare(
        "SELECT * FROM context_memory_entries WHERE owner_id=? ORDER BY pinned DESC,updated_at DESC,id LIMIT 1000"
      )
      .all(owner) as Row[];
    const candidates: { evidence: ContextMemoryEvidence; score: number; required?: boolean }[] = [];
    const sourceCache = new Map<string, SourceMessage | null>();
    for (const row of rows) {
      // Filter scope and relevance before reading source bodies, especially other projects.
      if (
        !(row.scope === "personal"
          ? settings.use_personal
          : row.scope === "chat"
            ? grants.chats.includes(row.chat_id!)
            : grants.projects.includes(row.project_id!)) ||
        (row.expires_at && Date.parse(row.expires_at) <= this.now())
      )
        continue;
      const text = (row.title + "\n" + row.content).normalize("NFKC").toLocaleLowerCase();
      const overlap = terms.filter((t) => text.includes(t)).length;
      // Pinned constraints and preferences survive topical filtering; hypotheses stay labeled.
      const stable =
        (row.scope === "personal" && row.kind !== "hypothesis") ||
        row.pinned ||
        row.kind === "constraint" ||
        row.kind === "preference";
      if (!overlap && !stable) continue;
      const entry = this.decode(row, sourceCache);
      if (
        !this.allowed(entry, settings, grants) ||
        (entry.source && excluded.has(entry.source.message_id))
      )
        continue;
      candidates.push({
        required: entry.pinned || entry.kind === "constraint",
        score: overlap * 10 + (entry.pinned ? 100 : 0) + (stable ? 5 : 0),
        evidence: {
          reference: "M:" + entry.id,
          kind: "memory",
          text: entry.content,
          title: entry.title,
          source: entry.source,
          memory_kind: entry.kind,
          priority: entry.pinned || entry.kind === "constraint",
          version: entry.version,
          excerpt_only: false
        }
      });
    }
    if (terms.length && (grants.chats.length || grants.projects.length)) {
      const placeholders = (values: string[]) =>
        values.length ? values.map(() => "?").join(",") : "NULL";
      const matches = this.db
        .prepare(
          "SELECT f.kind,f.source_id FROM chat_history_fts f " +
            "LEFT JOIN general_chat_messages g ON f.kind='general_message' AND g.id=f.source_id " +
            "LEFT JOIN messages p ON f.kind='project_message' AND p.id=f.source_id " +
            "WHERE chat_history_fts MATCH ? AND (g.chat_id IN (" +
            placeholders(grants.chats) +
            ") OR p.project_id IN (" +
            placeholders(grants.projects) +
            ")) " +
            "ORDER BY bm25(chat_history_fts),f.rowid DESC LIMIT 48"
        )
        .all(
          terms.map((t) => '"' + t.replaceAll('"', '""') + '"*').join(" OR "),
          ...grants.chats,
          ...grants.projects
        ) as { kind: string; source_id: string }[];
      for (const hit of matches) {
        if (excluded.has(hit.source_id)) continue;
        const kind = hit.kind === "general_message" ? "chat_message" : "project_message";
        const message = this.cachedMessage(kind, hit.source_id, owner, sourceCache);
        if (!message) continue;
        const lower = message.content.toLocaleLowerCase();
        const indexes = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
        const start = Math.max(0, Math.min(...indexes, message.content.length) - 160);
        const quote = message.content.slice(start, start + 600);
        if (!quote) continue;
        const source: ContextMemorySource = {
          kind,
          message_id: message.id,
          chat_id: message.chat_id,
          project_id: message.project_id,
          role: message.role,
          quote,
          sha256: hash(message.content)
        };
        candidates.push({
          score: indexes.length * 3,
          evidence: {
            reference: (kind === "chat_message" ? "H:g:" : "H:p:") + message.id,
            kind: "history",
            priority: false,
            title: message.created_at,
            text: quote,
            source,
            excerpt_only: start > 0 || quote.length < message.content.length
          }
        });
      }
    }
    const seen = new Set<string>();
    for (const { evidence, required } of candidates.sort(
      (a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || b.score - a.score
    )) {
      const key = evidence.text.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const next = { ...bundle, items: [...bundle.items, evidence] };
      // Reserve space for the final omitted count/byte length. Never cut a saved fact in half.
      if (bundle.items.length >= 32 || bytes(JSON.stringify(next)) + 64 > budget) {
        bundle.omitted++;
        if (required) bundle.priority_omitted++;
        continue;
      }
      bundle.items.push(evidence);
    }
    return this.measure(bundle);
  }
  private measure(bundle: ContextMemoryBundle) {
    // bytes itself changes the serialized size; converge to an exact fixed point.
    for (let i = 0; i < 4; i++) bundle.bytes = bytes(JSON.stringify(bundle));
    return bundle;
  }
  sourceFor(target: MemoryTarget, owner: string, reference: string, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000)
      throw new ContextMemoryError(400, "INVALID_MEMORY_QUERY");
    const settings = this.settings(target, owner),
      grants = this.grants(target, settings, owner);
    if (!settings.enabled) throw new ContextMemoryError(404, "MEMORY_SOURCE_NOT_FOUND");
    this.owned(target, owner, true);
    let source: ContextMemorySource | null = null;
    if (reference.startsWith("M:")) {
      const entry = this.get(reference.slice(2), owner);
      if (entry && this.allowed(entry, settings, grants)) source = entry.source;
    } else {
      const match = /^H:([gp]):(.{1,128})$/.exec(reference);
      if (match) {
        const kind = match[1] === "g" ? "chat_message" : "project_message";
        const message = this.message(kind, match[2]!, owner);
        if (
          message &&
          (kind === "chat_message"
            ? grants.chats.includes(message.chat_id)
            : grants.projects.includes(message.project_id!))
        )
          source = {
            kind,
            message_id: message.id,
            chat_id: message.chat_id,
            project_id: message.project_id,
            role: message.role,
            quote: "",
            sha256: hash(message.content)
          };
      }
    }
    if (!source) throw new ContextMemoryError(404, "MEMORY_SOURCE_NOT_FOUND");
    const message = this.message(source.kind, source.message_id, owner);
    if (!message || !this.matches(source, message))
      throw new ContextMemoryError(404, "MEMORY_SOURCE_NOT_FOUND");
    return {
      source,
      content: message.content.slice(offset, offset + 8000),
      offset,
      next_offset: offset + 8000 < message.content.length ? offset + 8000 : null,
      total_characters: message.content.length
    };
  }
}
