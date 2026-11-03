import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  containsSensitiveSecret,
  extractMemoryEntities,
  normalizeStem,
  type MemoryEntryKind
} from "./context-memory-hybrid-search.ts";

export interface ExtractedProfileCandidate {
  candidateId: string;
  ownerId: string;
  kind: MemoryEntryKind;
  title: string;
  verbatimQuote: string;
  quoteSha256: string;
  sourceChatId: string | null;
  sourceProjectId: string | null;
  sourceChatMessageId: string | null;
  sourceProjectMessageId: string | null;
  createdAt: string;
  duplicateOfEntryId: string | null;
  contradictsEntryId: string | null;
  contradictionReason: string | null;
  similarCandidateIds: string[];
}

export interface ProfileCandidateScanReport {
  method: "semantic-owner-quotes-v2";
  scannedMessages: number;
  candidates: ExtractedProfileCandidate[];
  skippedDismissedCount: number;
  skippedDuplicateCount: number;
  skippedSensitiveCount: number;
  contradictionCount: number;
}

const MAX_SCAN_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 16000;
const MIN_LINE_CHARS = 8;
const MAX_LINE_CHARS = 1000;
const MAX_LINES_PER_MESSAGE = 8;
const MAX_CANDIDATES = 30;
const MAX_SIMILAR_PAIRS = 5;
const MAX_DISMISSAL_FINGERPRINTS = 5000;

const CANDIDATE_PATTERNS: Array<{ kind: MemoryEntryKind; titlePrefixRu: string; regex: RegExp }> = [
  {
    kind: "constraint",
    titlePrefixRu: "Ограничение владельца",
    regex: /(?:^|[^\p{L}\p{N}_])(?:не\s+меняй|не\s+изменяй|строго\s+не|никогда\s+не|запрещено|обязательно\s+сохраняй|лимит\s+не\s+более|потолок\s+расходов|do\s+not\s+modify|never\s+change|strictly\s+prohibited|must\s+not)/iu
  },
  {
    kind: "preference",
    titlePrefixRu: "Предпочтение владельца",
    regex: /(?:^|[^\p{L}\p{N}_])(?:меня\s+зовут|я\s+предпочитаю|мне\s+удобнее|отвечай\s+на|пиши\s+кратко|используй\s+по\s+умолчанию|мой\s+рабочий\s+язык|i\s+prefer|always\s+respond\s+in|my\s+name\s+is)/iu
  },
  {
    kind: "decision",
    titlePrefixRu: "Принятое решение",
    regex: /(?:^|[^\p{L}\p{N}_])(?:мы\s+решили|наша\s+цель|утвердили\s+архитектуру|переходим\s+на|выбрали\s+вариант|we\s+decided|our\s+goal\s+is|agreed\s+to\s+use)/iu
  },
  {
    kind: "fact",
    titlePrefixRu: "Факт проекта/профиля",
    regex: /(?:^|[^\p{L}\p{N}_])(?:мой\s+проект|наш\s+репозиторий|рабочая\s+папка\s+находится|сервер\s+работает\s+на|контекстное\s+окно\s+модели|our\s+repository\s+is|production\s+server\s+runs)/iu
  }
];

function computeCandidateFingerprint(ownerId: string, normalizedQuote: string): string {
  return createHash("sha256")
    .update(`${ownerId}:candidate:v2:${normalizedQuote}`, "utf8")
    .digest("hex");
}

function hasNegation(text: string): boolean {
  return /(?:^|[^\p{L}\p{N}_])(?:не|нет|нельзя|запрещено|никогда|без|no|not|never|without|disable|off)(?=[^\p{L}\p{N}_]|$)/iu.test(
    text
  );
}

function shareCoreSubjectStems(a: string, b: string): boolean {
  const wordsA = (a.normalize("NFKC").toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).map(normalizeStem);
  const wordsB = new Set(
    (b.normalize("NFKC").toLowerCase().match(/[\p{L}]{4,}/gu) ?? []).map(normalizeStem)
  );
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  return shared >= 2;
}

export class ProfileCandidateReconciler {
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
      CREATE TABLE IF NOT EXISTS context_memory_versions (
        entry_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (entry_id, version)
      );
      CREATE TABLE IF NOT EXISTS profile_candidate_dismissals (
        owner_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        chat_message_id TEXT,
        project_message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(owner_id, candidate_id),
        CHECK((chat_message_id IS NULL) <> (project_message_id IS NULL))
      );
    `);
  }

  scanAuthorizedChatCandidates(
    ownerId: string,
    options?: { permittedChatIds?: string[]; permittedProjectIds?: string[] }
  ): ProfileCandidateScanReport {
    this.ensureSchema();

    const dismissedRows = this.sqlite
      .prepare(
        "SELECT candidate_id FROM profile_candidate_dismissals WHERE owner_id = ? LIMIT ?"
      )
      .all(ownerId, MAX_DISMISSAL_FINGERPRINTS) as Array<{ candidate_id: string }>;
    const dismissedSet = new Set(dismissedRows.map((r) => r.candidate_id));

    const existingEntries = this.sqlite
      .prepare(
        `SELECT id, scope, kind, title, content, pinned
         FROM context_memory_entries
         WHERE owner_id = ?
         ORDER BY pinned DESC, updated_at DESC`
      )
      .all(ownerId) as Array<{
      id: string;
      scope: string;
      kind: MemoryEntryKind;
      title: string;
      content: string;
      pinned: number;
    }>;

    const hasGeneralChats = Boolean(
      this.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='general_chat_messages'")
        .get()
    );

    const rawMessages: Array<{
      id: string;
      chatId: string | null;
      projectId: string | null;
      content: string;
      createdAt: string;
      sourceType: "chat" | "project";
    }> = [];

    if (hasGeneralChats) {
      const chatRows = this.sqlite
        .prepare(
          `SELECT m.id, m.chat_id, m.content, m.created_at
           FROM general_chat_messages m
           JOIN general_chats c ON c.id = m.chat_id AND c.owner_id = m.owner_id
           WHERE m.owner_id = ? AND m.role = 'user' AND m.status = 'completed'
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(ownerId, MAX_SCAN_MESSAGES) as Array<{
        id: string;
        chat_id: string;
        content: string;
        created_at: string;
      }>;

      const allowedChatSet =
        options?.permittedChatIds && options.permittedChatIds.length > 0
          ? new Set(options.permittedChatIds)
          : null;

      for (const r of chatRows) {
        if (allowedChatSet && !allowedChatSet.has(r.chat_id)) continue;
        rawMessages.push({
          id: r.id,
          chatId: r.chat_id,
          projectId: null,
          content: r.content.slice(0, MAX_MESSAGE_CHARS),
          createdAt: r.created_at,
          sourceType: "chat"
        });
      }
    }

    let skippedDismissedCount = 0;
    let skippedDuplicateCount = 0;
    let skippedSensitiveCount = 0;
    let contradictionCount = 0;
    const candidates: ExtractedProfileCandidate[] = [];
    const seenFingerprints = new Set<string>();

    for (const msg of rawMessages) {
      if (candidates.length >= MAX_CANDIDATES) break;

      const lines = msg.content
        .normalize("NFKC")
        .split(/\r?\n|(?<=[.!?])\s+/u)
        .map((l) => l.trim())
        .filter((l) => l.length >= MIN_LINE_CHARS && l.length <= MAX_LINE_CHARS)
        .slice(0, MAX_LINES_PER_MESSAGE);

      for (const line of lines) {
        if (candidates.length >= MAX_CANDIDATES) break;

        if (containsSensitiveSecret(line)) {
          skippedSensitiveCount++;
          continue;
        }

        const matchedRule = CANDIDATE_PATTERNS.find((p) => p.regex.test(line));
        if (!matchedRule) continue;

        const normQuote = line.toLowerCase().replace(/\s+/g, " ");
        const candidateId = computeCandidateFingerprint(ownerId, normQuote);

        if (dismissedSet.has(candidateId) || seenFingerprints.has(candidateId)) {
          skippedDismissedCount++;
          continue;
        }
        seenFingerprints.add(candidateId);

        let duplicateOfEntryId: string | null = null;
        let contradictsEntryId: string | null = null;
        let contradictionReason: string | null = null;

        const candEntities = extractMemoryEntities(line);
        const candNumbers = candEntities.filter(
          (e) => e.kind === "money_or_number" || e.kind === "date"
        );

        for (const existing of existingEntries) {
          const existingNorm = existing.content.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
          if (existingNorm === normQuote || existingNorm.includes(normQuote)) {
            duplicateOfEntryId = existing.id;
            break;
          }

          if (shareCoreSubjectStems(line, existing.content)) {
            const existingEntities = extractMemoryEntities(existing.content);
            const existingNumbers = existingEntities.filter(
              (e) => e.kind === "money_or_number" || e.kind === "date"
            );

            if (
              candNumbers.length > 0 &&
              existingNumbers.length > 0 &&
              candNumbers[0].normalized !== existingNumbers[0].normalized
            ) {
              contradictsEntryId = existing.id;
              contradictionReason = `Новое значение (${candNumbers[0].raw}) расходится с сохранённой записью «${existing.title}» (${existingNumbers[0].raw})`;
              break;
            }

            if (hasNegation(line) !== hasNegation(existing.content)) {
              contradictsEntryId = existing.id;
              contradictionReason = `Противоположное условие относительно сохранённой записи «${existing.title}»`;
              break;
            }
          }
        }

        if (duplicateOfEntryId) {
          skippedDuplicateCount++;
          continue;
        }
        if (contradictsEntryId) {
          contradictionCount++;
        }

        const quoteSha256 = createHash("sha256").update(line, "utf8").digest("hex");
        const shortSnippet = line.length > 56 ? `${line.slice(0, 53).trim()}...` : line;

        candidates.push({
          candidateId,
          ownerId,
          kind: matchedRule.kind,
          title: `${matchedRule.titlePrefixRu}: ${shortSnippet}`,
          verbatimQuote: line,
          quoteSha256,
          sourceChatId: msg.chatId,
          sourceProjectId: msg.projectId,
          sourceChatMessageId: msg.sourceType === "chat" ? msg.id : null,
          sourceProjectMessageId: msg.sourceType === "project" ? msg.id : null,
          createdAt: msg.createdAt,
          duplicateOfEntryId: null,
          contradictsEntryId,
          contradictionReason,
          similarCandidateIds: []
        });
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (shareCoreSubjectStems(candidates[i].verbatimQuote, candidates[j].verbatimQuote)) {
          if (candidates[i].similarCandidateIds.length < MAX_SIMILAR_PAIRS) {
            candidates[i].similarCandidateIds.push(candidates[j].candidateId);
          }
          if (candidates[j].similarCandidateIds.length < MAX_SIMILAR_PAIRS) {
            candidates[j].similarCandidateIds.push(candidates[i].candidateId);
          }
        }
      }
    }

    return {
      method: "semantic-owner-quotes-v2",
      scannedMessages: rawMessages.length,
      candidates,
      skippedDismissedCount,
      skippedDuplicateCount,
      skippedSensitiveCount,
      contradictionCount
    };
  }

  promoteCandidateToProfile(options: {
    ownerId: string;
    candidate: ExtractedProfileCandidate;
    resolution?: "replace_existing" | "keep_both";
    pinned?: boolean;
  }): { entryId: string; replacedEntryId: string | null; version: number } {
    this.ensureSchema();
    const now = new Date().toISOString();
    const resolution = options.resolution ?? "replace_existing";
    const pinned = Number(options.pinned ?? options.candidate.kind === "constraint");

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const sourcePayload = {
        kind: "message",
        reference:
          options.candidate.sourceChatMessageId ??
          options.candidate.sourceProjectMessageId ??
          options.candidate.candidateId,
        chatId: options.candidate.sourceChatId,
        projectId: options.candidate.sourceProjectId,
        quote: options.candidate.verbatimQuote,
        sha256: options.candidate.quoteSha256,
        promotedFromCandidateId: options.candidate.candidateId
      };

      if (
        options.candidate.contradictsEntryId &&
        resolution === "replace_existing"
      ) {
        const targetId = options.candidate.contradictsEntryId;
        const existing = this.sqlite
          .prepare("SELECT version FROM context_memory_entries WHERE id = ? AND owner_id = ?")
          .get(targetId, options.ownerId) as { version: number } | undefined;

        if (existing) {
          const nextVer = existing.version + 1;
          this.sqlite
            .prepare(
              `UPDATE context_memory_entries
               SET scope = 'personal', kind = ?, title = ?, content = ?, pinned = ?,
                   source_chat_message_id = ?, source_project_message_id = ?, source_json = ?,
                   version = ?, updated_at = ?
               WHERE id = ? AND owner_id = ?`
            )
            .run(
              options.candidate.kind,
              options.candidate.title,
              options.candidate.verbatimQuote,
              pinned,
              options.candidate.sourceChatMessageId,
              options.candidate.sourceProjectMessageId,
              JSON.stringify(sourcePayload),
              nextVer,
              now,
              targetId,
              options.ownerId
            );

          this.sqlite
            .prepare(
              "INSERT OR REPLACE INTO context_memory_versions (entry_id, version, snapshot_json) VALUES (?, ?, ?)"
            )
            .run(
              targetId,
              nextVer,
              JSON.stringify({
                id: targetId,
                ownerId: options.ownerId,
                scope: "personal",
                kind: options.candidate.kind,
                title: options.candidate.title,
                content: options.candidate.verbatimQuote,
                source: sourcePayload,
                version: nextVer,
                updatedAt: now
              })
            );

          this.recordDismissalFingerprint(
            options.ownerId,
            options.candidate.candidateId,
            options.candidate.sourceChatMessageId,
            options.candidate.sourceProjectMessageId
          );

          this.sqlite.exec("COMMIT");
          return { entryId: targetId, replacedEntryId: targetId, version: nextVer };
        }
      }

      const newId = randomUUID();
      this.sqlite
        .prepare(
          `INSERT INTO context_memory_entries (
            id, owner_id, scope, chat_id, project_id, kind, title, content, pinned,
            expires_at, source_chat_message_id, source_project_message_id, source_json,
            version, created_at, updated_at, creation_key, creation_sha256
          ) VALUES (?, ?, 'personal', NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .run(
          newId,
          options.ownerId,
          options.candidate.kind,
          options.candidate.title,
          options.candidate.verbatimQuote,
          pinned,
          options.candidate.sourceChatMessageId,
          options.candidate.sourceProjectMessageId,
          JSON.stringify(sourcePayload),
          now,
          now,
          `promoted:${options.candidate.candidateId}`,
          options.candidate.quoteSha256
        );

      this.sqlite
        .prepare(
          "INSERT INTO context_memory_versions (entry_id, version, snapshot_json) VALUES (?, 1, ?)"
        )
        .run(
          newId,
          JSON.stringify({
            id: newId,
            ownerId: options.ownerId,
            scope: "personal",
            kind: options.candidate.kind,
            title: options.candidate.title,
            content: options.candidate.verbatimQuote,
            source: sourcePayload,
            version: 1,
            updatedAt: now
          })
        );

      this.recordDismissalFingerprint(
        options.ownerId,
        options.candidate.candidateId,
        options.candidate.sourceChatMessageId,
        options.candidate.sourceProjectMessageId
      );

      this.sqlite.exec("COMMIT");
      return { entryId: newId, replacedEntryId: null, version: 1 };
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  deleteMemoryWithAutoExtractException(ownerId: string, entryId: string): {
    deleted: boolean;
    exceptionCandidateId: string | null;
    sourceConversationIntact: boolean;
  } {
    this.ensureSchema();
    const row = this.sqlite
      .prepare(
        `SELECT id, content, source_chat_message_id, source_project_message_id
         FROM context_memory_entries
         WHERE id = ? AND owner_id = ?`
      )
      .get(entryId, ownerId) as
      | {
          id: string;
          content: string;
          source_chat_message_id: string | null;
          source_project_message_id: string | null;
        }
      | undefined;

    if (!row) {
      return { deleted: false, exceptionCandidateId: null, sourceConversationIntact: true };
    }

    const normQuote = row.content.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    const candidateId = computeCandidateFingerprint(ownerId, normQuote);

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare("DELETE FROM context_memory_entries WHERE id = ? AND owner_id = ?")
        .run(entryId, ownerId);
      this.sqlite
        .prepare("DELETE FROM context_memory_versions WHERE entry_id = ?")
        .run(entryId);

      if (row.source_chat_message_id || row.source_project_message_id) {
        this.recordDismissalFingerprint(
          ownerId,
          candidateId,
          row.source_chat_message_id,
          row.source_project_message_id
        );
      }
      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    let sourceConversationIntact = true;
    if (row.source_chat_message_id) {
      const msgStillExists = this.sqlite
        .prepare("SELECT id FROM general_chat_messages WHERE id = ? AND owner_id = ?")
        .get(row.source_chat_message_id, ownerId);
      sourceConversationIntact = Boolean(msgStillExists);
    }

    return {
      deleted: true,
      exceptionCandidateId: candidateId,
      sourceConversationIntact
    };
  }

  private recordDismissalFingerprint(
    ownerId: string,
    candidateId: string,
    chatMessageId: string | null,
    projectMessageId: string | null
  ): void {
    const cleanChatMsgId = chatMessageId ?? null;
    const cleanProjMsgId = cleanChatMsgId ? null : projectMessageId ?? null;
    if (!cleanChatMsgId && !cleanProjMsgId) return;

    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO profile_candidate_dismissals (
          owner_id, candidate_id, chat_message_id, project_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(ownerId, candidateId, cleanChatMsgId, cleanProjMsgId, new Date().toISOString());
  }
}
