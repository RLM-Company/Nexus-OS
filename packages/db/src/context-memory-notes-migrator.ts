import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { containsSensitiveSecret, type MemoryEntryKind } from "./context-memory-hybrid-search.ts";

export interface MigratedMemoryRecord {
  contextMemoryId: string;
  legacySourceKind: "project_memory" | "general_chat_note";
  legacyId: string;
  projectId: string | null;
  chatId: string | null;
  title: string;
  kind: MemoryEntryKind;
  pinned: boolean;
  sourceVerified: boolean;
  status: "migrated" | "already_migrated" | "skipped_sensitive";
}

export interface LegacyNotesMigrationResult {
  ownerId: string;
  migratedCount: number;
  alreadyMigratedCount: number;
  skippedSensitiveCount: number;
  records: MigratedMemoryRecord[];
}

export interface OwnerDefaultMemoryRules {
  ownerId: string;
  defaultEnabled: boolean;
  defaultUsePersonal: boolean;
  defaultAutoExtract: boolean;
  defaultTemporaryMode: boolean;
  updatedAt: string;
  version: number;
}

export interface ChatMemoryModeState {
  ownerId: string;
  chatId: string;
  enabled: boolean;
  usePersonal: boolean;
  temporaryMode: boolean;
  autoExtractAllowed: boolean;
  version: number;
}

function inferMemoryKind(title: string, content: string, pinned: boolean): MemoryEntryKind {
  const combined = `${title} ${content}`.normalize("NFKC").toLowerCase();
  if (
    pinned ||
    /\b(?:нельзя|запрещено|обязательно|строго|лимит|ограничение|must\s+not|never|constraint|strictly)\b/u.test(
      combined
    )
  ) {
    return "constraint";
  }
  if (/\b(?:решили|решение|выбрали|утвердили|decided|decision|agreed)\b/u.test(combined)) {
    return "decision";
  }
  if (/\b(?:предпочитаю|нравится|стиль|язык|prefer|preference|default)\b/u.test(combined)) {
    return "preference";
  }
  if (/\b(?:гипотеза|предположение|возможно|проверить|hypothesis|maybe)\b/u.test(combined)) {
    return "hypothesis";
  }
  return "fact";
}

export class ContextMemoryNotesMigrator {
  constructor(private readonly sqlite: DatabaseSync) {}

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS context_memory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('personal', 'chat', 'project')),
        chat_id TEXT,
        project_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'preference', 'decision', 'constraint', 'hypothesis')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        source_chat_message_id TEXT,
        source_project_message_id TEXT,
        source_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        creation_key TEXT,
        creation_sha256 TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS context_memory_owner_creation_key_idx
        ON context_memory_entries(owner_id, creation_key)
        WHERE creation_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS context_memory_versions (
        entry_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (entry_id, version)
      );
      CREATE TABLE IF NOT EXISTS context_memory_owner_defaults (
        owner_id TEXT PRIMARY KEY NOT NULL,
        default_enabled INTEGER NOT NULL DEFAULT 1,
        default_use_personal INTEGER NOT NULL DEFAULT 1,
        default_auto_extract INTEGER NOT NULL DEFAULT 0,
        default_temporary_mode INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS context_memory_settings (
        owner_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        chat_id TEXT,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        use_personal INTEGER NOT NULL DEFAULT 1,
        source_chat_ids_json TEXT NOT NULL DEFAULT '[]',
        project_ids_json TEXT NOT NULL DEFAULT '[]',
        temporary_mode INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (owner_id, target_kind, target_id)
      );
    `);

    // Ensure temporary_mode column exists if context_memory_settings was created by 0056_context_memory.sql
    const cols = this.sqlite
      .prepare("PRAGMA table_info(context_memory_settings)")
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "temporary_mode")) {
      this.sqlite.exec(
        "ALTER TABLE context_memory_settings ADD COLUMN temporary_mode INTEGER NOT NULL DEFAULT 0"
      );
    }
  }

  migrateOwnerLegacyMemory(ownerId: string): LegacyNotesMigrationResult {
    this.ensureSchema();
    const records: MigratedMemoryRecord[] = [];
    let migratedCount = 0;
    let alreadyMigratedCount = 0;
    let skippedSensitiveCount = 0;

    const hasProjectMemoryTable = Boolean(
      this.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_memory'")
        .get()
    );

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (hasProjectMemoryTable) {
        const legacyRows = this.sqlite
          .prepare(
            `SELECT id, project_id, owner_id, version, title, content, source_json, pinned, created_at, updated_at
             FROM project_memory
             WHERE owner_id = ? AND forgotten = 0
             ORDER BY created_at ASC, id ASC`
          )
          .all(ownerId) as Array<{
          id: string;
          project_id: string;
          owner_id: string;
          version: number;
          title: string;
          content: string;
          source_json: string;
          pinned: number;
          created_at: string;
          updated_at: string;
        }>;

        for (const row of legacyRows) {
          const creationKey = `legacy-project-memory:${row.id}`;
          const existing = this.sqlite
            .prepare(
              "SELECT id, kind, pinned, source_json FROM context_memory_entries WHERE owner_id = ? AND creation_key = ?"
            )
            .get(ownerId, creationKey) as
            | { id: string; kind: MemoryEntryKind; pinned: number; source_json: string }
            | undefined;

          if (existing) {
            let parsedExistingSource: Record<string, unknown> = {};
            try {
              parsedExistingSource = JSON.parse(existing.source_json) as Record<string, unknown>;
            } catch {
              parsedExistingSource = {};
            }
            alreadyMigratedCount++;
            records.push({
              contextMemoryId: existing.id,
              legacySourceKind: "project_memory",
              legacyId: row.id,
              projectId: row.project_id,
              chatId: null,
              title: row.title,
              kind: existing.kind,
              pinned: Boolean(existing.pinned),
              sourceVerified: Boolean(parsedExistingSource.sourceVerified),
              status: "already_migrated"
            });
            continue;
          }

          if (containsSensitiveSecret(row.title) || containsSensitiveSecret(row.content)) {
            skippedSensitiveCount++;
            records.push({
              contextMemoryId: "",
              legacySourceKind: "project_memory",
              legacyId: row.id,
              projectId: row.project_id,
              chatId: null,
              title: row.title,
              kind: "fact",
              pinned: Boolean(row.pinned),
              sourceVerified: false,
              status: "skipped_sensitive"
            });
            continue;
          }

          let rawSource: Record<string, unknown> = {};
          try {
            rawSource = JSON.parse(row.source_json || "{}") as Record<string, unknown>;
          } catch {
            rawSource = {};
          }

          const sourceKind = typeof rawSource.kind === "string" ? rawSource.kind : "note";
          const sourceRef = typeof rawSource.reference === "string" ? rawSource.reference : row.id;
          const sourceVerified = this.verifyLegacySourceReference(
            ownerId,
            row.project_id,
            sourceKind,
            sourceRef
          );

          const sourceQuote =
            typeof rawSource.quote === "string" && rawSource.quote.trim()
              ? rawSource.quote
              : row.content;
          const quoteSha256 = createHash("sha256").update(sourceQuote, "utf8").digest("hex");

          const enrichedSource = {
            ...rawSource,
            kind: sourceKind,
            reference: sourceRef,
            legacyTable: "project_memory",
            legacyId: row.id,
            legacyVersion: row.version,
            quote: sourceQuote,
            sha256: quoteSha256,
            sourceVerified
          };

          const entryId = randomUUID();
          const kind = inferMemoryKind(row.title, row.content, Boolean(row.pinned));
          const creationSha256 = createHash("sha256")
            .update(
              JSON.stringify({
                projectId: row.project_id,
                title: row.title,
                content: row.content,
                source: enrichedSource
              }),
              "utf8"
            )
            .digest("hex");

          const sourceProjectMessageId =
            sourceKind === "message" && sourceVerified ? sourceRef : null;

          this.sqlite
            .prepare(
              `INSERT INTO context_memory_entries (
                id, owner_id, scope, chat_id, project_id, kind, title, content, pinned,
                expires_at, source_chat_message_id, source_project_message_id, source_json,
                version, created_at, updated_at, creation_key, creation_sha256
              ) VALUES (?, ?, 'project', NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?, ?)`
            )
            .run(
              entryId,
              ownerId,
              row.project_id,
              kind,
              row.title,
              row.content,
              Number(Boolean(row.pinned)),
              sourceProjectMessageId,
              JSON.stringify(enrichedSource),
              row.created_at,
              row.updated_at,
              creationKey,
              creationSha256
            );

          this.sqlite
            .prepare(
              `INSERT INTO context_memory_versions (entry_id, version, snapshot_json)
               VALUES (?, 1, ?)`
            )
            .run(
              entryId,
              JSON.stringify({
                id: entryId,
                ownerId,
                scope: "project",
                projectId: row.project_id,
                kind,
                title: row.title,
                content: row.content,
                pinned: Boolean(row.pinned),
                source: enrichedSource,
                version: 1,
                createdAt: row.created_at,
                updatedAt: row.updated_at
              })
            );

          migratedCount++;
          records.push({
            contextMemoryId: entryId,
            legacySourceKind: "project_memory",
            legacyId: row.id,
            projectId: row.project_id,
            chatId: null,
            title: row.title,
            kind,
            pinned: Boolean(row.pinned),
            sourceVerified,
            status: "migrated"
          });
        }
      }

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw err;
    }

    return {
      ownerId,
      migratedCount,
      alreadyMigratedCount,
      skippedSensitiveCount,
      records
    };
  }

  getOwnerDefaultRules(ownerId: string): OwnerDefaultMemoryRules {
    this.ensureSchema();
    const row = this.sqlite
      .prepare("SELECT * FROM context_memory_owner_defaults WHERE owner_id = ?")
      .get(ownerId) as
      | {
          owner_id: string;
          default_enabled: number;
          default_use_personal: number;
          default_auto_extract: number;
          default_temporary_mode: number;
          version: number;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return {
        ownerId,
        defaultEnabled: true,
        defaultUsePersonal: true,
        defaultAutoExtract: false,
        defaultTemporaryMode: false,
        updatedAt: new Date(0).toISOString(),
        version: 1
      };
    }

    return {
      ownerId: row.owner_id,
      defaultEnabled: Boolean(row.default_enabled),
      defaultUsePersonal: Boolean(row.default_use_personal),
      defaultAutoExtract: Boolean(row.default_auto_extract),
      defaultTemporaryMode: Boolean(row.default_temporary_mode),
      updatedAt: row.updated_at,
      version: row.version
    };
  }

  updateOwnerDefaultRules(
    ownerId: string,
    input: Partial<
      Pick<
        OwnerDefaultMemoryRules,
        "defaultEnabled" | "defaultUsePersonal" | "defaultAutoExtract" | "defaultTemporaryMode"
      >
    >
  ): OwnerDefaultMemoryRules {
    this.ensureSchema();
    const current = this.getOwnerDefaultRules(ownerId);
    const next: OwnerDefaultMemoryRules = {
      ownerId,
      defaultEnabled: input.defaultEnabled ?? current.defaultEnabled,
      defaultUsePersonal: input.defaultUsePersonal ?? current.defaultUsePersonal,
      defaultAutoExtract: input.defaultAutoExtract ?? current.defaultAutoExtract,
      defaultTemporaryMode: input.defaultTemporaryMode ?? current.defaultTemporaryMode,
      updatedAt: new Date().toISOString(),
      version: current.updatedAt === new Date(0).toISOString() ? 1 : current.version + 1
    };

    this.sqlite
      .prepare(
        `INSERT INTO context_memory_owner_defaults (
          owner_id, default_enabled, default_use_personal, default_auto_extract, default_temporary_mode, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET
          default_enabled = excluded.default_enabled,
          default_use_personal = excluded.default_use_personal,
          default_auto_extract = excluded.default_auto_extract,
          default_temporary_mode = excluded.default_temporary_mode,
          version = excluded.version,
          updated_at = excluded.updated_at`
      )
      .run(
        ownerId,
        Number(next.defaultEnabled),
        Number(next.defaultUsePersonal),
        Number(next.defaultAutoExtract),
        Number(next.defaultTemporaryMode),
        next.version,
        next.updatedAt
      );

    return next;
  }

  initializeNewChatMemorySettings(
    ownerId: string,
    chatId: string,
    options?: { temporaryMode?: boolean }
  ): ChatMemoryModeState {
    this.ensureSchema();
    const defaults = this.getOwnerDefaultRules(ownerId);
    const temporaryMode = options?.temporaryMode ?? defaults.defaultTemporaryMode;
    const enabled = temporaryMode ? false : defaults.defaultEnabled;
    const usePersonal = temporaryMode ? false : defaults.defaultUsePersonal;

    this.sqlite
      .prepare(
        `INSERT INTO context_memory_settings (
          owner_id, target_kind, target_id, chat_id, project_id, enabled, use_personal,
          source_chat_ids_json, project_ids_json, temporary_mode, version
        ) VALUES (?, 'chat', ?, ?, NULL, ?, ?, '[]', '[]', ?, 1)
        ON CONFLICT(owner_id, target_kind, target_id) DO UPDATE SET
          enabled = excluded.enabled,
          use_personal = excluded.use_personal,
          temporary_mode = excluded.temporary_mode,
          version = context_memory_settings.version + 1`
      )
      .run(ownerId, chatId, chatId, Number(enabled), Number(usePersonal), Number(temporaryMode));

    const row = this.sqlite
      .prepare(
        "SELECT enabled, use_personal, temporary_mode, version FROM context_memory_settings WHERE owner_id = ? AND target_kind = 'chat' AND target_id = ?"
      )
      .get(ownerId, chatId) as {
      enabled: number;
      use_personal: number;
      temporary_mode: number;
      version: number;
    };

    return {
      ownerId,
      chatId,
      enabled: Boolean(row.enabled),
      usePersonal: Boolean(row.use_personal),
      temporaryMode: Boolean(row.temporary_mode),
      autoExtractAllowed: !row.temporary_mode && defaults.defaultAutoExtract,
      version: row.version
    };
  }

  private verifyLegacySourceReference(
    ownerId: string,
    projectId: string,
    sourceKind: string,
    reference: string
  ): boolean {
    if (!reference) return false;
    if (sourceKind === "artifact") {
      const hasTable = this.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_artifact_versions'")
        .get();
      if (!hasTable) return false;
      const found = this.sqlite
        .prepare("SELECT id FROM work_artifact_versions WHERE id = ? AND project_id = ?")
        .get(reference, projectId);
      return Boolean(found);
    }
    if (sourceKind === "message") {
      const hasMessages = this.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
        .get();
      if (hasMessages) {
        const found = this.sqlite
          .prepare("SELECT id FROM messages WHERE id = ? AND project_id = ?")
          .get(reference, projectId);
        if (found) return true;
      }
    }
    // For "note" or manual references, verify the project belongs to the owner
    const hasProjects = this.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .get();
    if (hasProjects) {
      const owned = this.sqlite
        .prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
        .get(projectId, ownerId);
      return Boolean(owned);
    }
    return true;
  }
}
