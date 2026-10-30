import { ChatSkillStore } from "./chat-skill-store.js";
import { ContextMemoryStore } from "./context-memory-store.js";
import { ChatWorkspaceStore } from "./chat-workspace-store.js";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  isValidChatAttachments,
  CHAT_MEMORY_MAX_LENGTH,
  type ChatMemory,
  type ContextMemoryBundle,
  type ChatBranchList,
  type CreateChatBranch,
  sameChatAttachments,
  type ChatAttachment,
  type Currency
} from "@cosmora/contracts";
import {
  IdempotencyConflictError,
  LOCAL_OWNER_ID,
  ModelUsageConflictError,
  type ModelUsageReservation
} from "./project-store.js";

export class GeneralChatBusyError extends Error {
  constructor() {
    super("Chat already has a queued or running response");
    this.name = "GeneralChatBusyError";
  }
}

export class ChatMemoryConflictError extends Error {}
export class ChatBranchValidationError extends Error {}

export interface StoredGeneralChat {
  id: string;
  title: string;
  mode: "kosmora" | "work" | "coscode";
  created_at: string;
  updated_at: string;
}

export interface StoredGeneralChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content_type: "text";
  content: string;
  attachments?: ChatAttachment[];
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  run_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredGeneralChatRun {
  id: string;
  chat_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  provider: string | null;
  model_resolved: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export interface StoredGeneralChatUsage {
  usage_id: string;
  run_id: string;
  chat_id: string;
  attempt: number;
  status: "reserved" | "committed" | "failed" | "cancelled";
  registry_version: string;
  provider_id: string;
  model_requested: string;
  model_resolved: string | null;
  estimated_input_tokens: number;
  max_output_tokens: number;
  estimated_cost_amount: number | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  calculated_cost_amount: number | null;
  currency: Currency | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcceptedGeneralChatMessage {
  chat: StoredGeneralChat;
  userMessage: StoredGeneralChatMessage;
  run: StoredGeneralChatRun;
  duplicate: boolean;
}

type SqlRow = Record<string, unknown>;
const timestamp = (): string => new Date().toISOString();
const asChat = (row: SqlRow): StoredGeneralChat => row as unknown as StoredGeneralChat;
const asMessage = (row: SqlRow): StoredGeneralChatMessage => {
  const { attachments_json, ...message } = row;
  if (typeof attachments_json !== "string") throw new Error("Invalid persisted chat attachments");
  const attachments = JSON.parse(attachments_json) as ChatAttachment[];
  return {
    ...message,
    ...(attachments.length ? { attachments } : {})
  } as unknown as StoredGeneralChatMessage;
};
const sameAttachments = (
  message: StoredGeneralChatMessage,
  attachments: ChatAttachment[]
): boolean => sameChatAttachments(message.attachments ?? [], attachments);
const assertAttachments = (attachments: ChatAttachment[]): void => {
  if (!isValidChatAttachments(attachments)) throw new Error("Invalid chat attachments");
};
const asRun = (row: SqlRow): StoredGeneralChatRun => row as unknown as StoredGeneralChatRun;
const asUsage = (row: SqlRow): StoredGeneralChatUsage => row as unknown as StoredGeneralChatUsage;
const titleFor = (content: string): string => {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 58 ? `${compact.slice(0, 57)}…` : compact;
};

const MESSAGE_COLUMNS = `id, chat_id, role, content_type, content, attachments_json, status,
  run_id, error_code, created_at, updated_at`;
const RUN_COLUMNS = `id, chat_id, status, provider, model_resolved,
  input_tokens, output_tokens, created_at, updated_at`;
const USAGE_COLUMNS = `usage_id, run_id, chat_id, attempt, status, registry_version, provider_id,
  model_requested, model_resolved, estimated_input_tokens, max_output_tokens,
  estimated_cost_amount, actual_input_tokens, actual_output_tokens,
  calculated_cost_amount, currency, error_code, created_at, updated_at`;

export class GeneralChatStore {
  readonly #sqlite: DatabaseSync;
  readonly workspace: ChatWorkspaceStore;
  readonly skills: ChatSkillStore;
  readonly contextMemory: ContextMemoryStore;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
    this.workspace = new ChatWorkspaceStore(sqlite);
    this.skills = new ChatSkillStore(sqlite);
    this.contextMemory = new ContextMemoryStore(sqlite);
  }

  listChats(
    ownerId = LOCAL_OWNER_ID,
    archived = false
  ): Array<StoredGeneralChat & { last_message_preview: string | null }> {
    return this.#sqlite
      .prepare(
        `SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
          (SELECT substr(content, 1, 240) FROM general_chat_messages m
           WHERE m.chat_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1)
           AS last_message_preview
         FROM general_chats c WHERE c.owner_id = ? AND c.archived = ?
         ORDER BY c.updated_at DESC`
      )
      .all(ownerId, Number(archived)) as unknown as Array<
      StoredGeneralChat & { last_message_preview: string | null }
    >;
  }

  getChat(chatId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChat | null {
    const row = this.#sqlite
      .prepare(
        "SELECT id, title, mode, created_at, updated_at FROM general_chats WHERE id = ? AND owner_id = ?"
      )
      .get(chatId, ownerId) as SqlRow | undefined;
    return row ? asChat(row) : null;
  }

  getChatMemory(chatId: string, ownerId = LOCAL_OWNER_ID): ChatMemory | null {
    if (!this.getChat(chatId, ownerId)) return null;
    const row = this.#sqlite
      .prepare("SELECT memory_notes, version, updated_at FROM chat_memory_notes WHERE chat_id=?")
      .get(chatId) as ChatMemory | undefined;
    return row ?? { memory_notes: "", version: 0, updated_at: null };
  }

  updateChatMemory(
    chatId: string,
    ownerId: string,
    memoryNotes: string,
    expectedVersion: number
  ): ChatMemory | null {
    if (
      typeof memoryNotes !== "string" ||
      memoryNotes.length > CHAT_MEMORY_MAX_LENGTH ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0
    )
      throw new Error("Invalid chat memory");
    this.#sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getChatMemory(chatId, ownerId);
      if (!current) {
        this.#sqlite.exec("COMMIT");
        return null;
      }
      if (
        this.#sqlite
          .prepare(
            "SELECT 1 FROM general_chat_runs WHERE chat_id=? AND status IN ('queued','running')"
          )
          .get(chatId)
      )
        throw new GeneralChatBusyError();
      if (current.version !== expectedVersion || expectedVersion === Number.MAX_SAFE_INTEGER)
        throw new ChatMemoryConflictError("Chat memory changed elsewhere");
      this.#sqlite
        .prepare(
          `INSERT INTO chat_memory_notes(chat_id,memory_notes,version,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(chat_id) DO UPDATE SET memory_notes=excluded.memory_notes,
         version=excluded.version,updated_at=excluded.updated_at`
        )
        .run(chatId, memoryNotes, current.version + 1, timestamp());
      const result = this.getChatMemory(chatId, ownerId);
      this.#sqlite.exec("COMMIT");
      return result;
    } catch (cause) {
      this.#sqlite.exec("ROLLBACK");
      throw cause;
    }
  }

  updateChat(
    chatId: string,
    ownerId: string,
    update: { title?: string; archived?: boolean }
  ): StoredGeneralChat | null {
    const chat = this.getChat(chatId, ownerId);
    if (!chat) return null;
    if (update.title !== undefined && (!update.title.trim() || update.title.length > 160))
      throw new Error("Invalid chat title");
    if (
      update.archived === true &&
      this.#sqlite
        .prepare(
          "SELECT 1 FROM general_chat_runs WHERE chat_id = ? AND status IN ('queued', 'running')"
        )
        .get(chatId)
    )
      throw new GeneralChatBusyError();
    this.#sqlite
      .prepare(
        "UPDATE general_chats SET title = ?, archived = coalesce(?, archived), updated_at = ? WHERE id = ? AND owner_id = ?"
      )
      .run(
        update.title?.trim() ?? chat.title,
        update.archived === undefined ? null : Number(update.archived),
        timestamp(),
        chatId,
        ownerId
      );
    return this.getChat(chatId, ownerId);
  }

  listMessages(chatId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatMessage[] {
    if (!this.getChat(chatId, ownerId)) return [];
    return this.#sqlite
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages
         WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(chatId)
      .map((row) => asMessage(row as SqlRow));
  }

  listChatBranches(chatId: string, ownerId = LOCAL_OWNER_ID): ChatBranchList | null {
    if (!this.getChat(chatId, ownerId)) return null;
    const ancestry = this.#sqlite
      .prepare("SELECT root_chat_id FROM chat_branches WHERE chat_id=?")
      .get(chatId) as { root_chat_id: string | null } | undefined;
    const root =
      ancestry?.root_chat_id && this.getChat(ancestry.root_chat_id, ownerId)
        ? ancestry.root_chat_id
        : chatId;
    const items = this.#sqlite
      .prepare(
        `SELECT c.id AS chat_id,c.title,coalesce(b.kind,'original') AS kind,c.created_at
       FROM general_chats c LEFT JOIN chat_branches b ON b.chat_id=c.id
       WHERE c.owner_id=? AND (c.id=? OR b.root_chat_id=?)
       ORDER BY CASE WHEN c.id=? THEN 0 ELSE 1 END,b.rowid`
      )
      .all(ownerId, root, root, root) as unknown as ChatBranchList["items"];
    return { root_chat_id: root, items };
  }

  createChatBranch(
    chatId: string,
    ownerId: string,
    input: CreateChatBranch
  ): AcceptedGeneralChatMessage | null {
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          chatId,
          input.message_id,
          input.kind,
          input.kind === "edit" ? input.content : null
        ])
      )
      .digest("hex");
    this.#sqlite.exec("BEGIN IMMEDIATE");
    try {
      const parent = this.getChat(chatId, ownerId);
      if (!parent) {
        this.#sqlite.exec("COMMIT");
        return null;
      }
      const existing = this.getChat(input.client_branch_id, ownerId);
      const metadata = this.#sqlite
        .prepare("SELECT request_digest FROM chat_branches WHERE chat_id=?")
        .get(input.client_branch_id) as { request_digest: string } | undefined;
      if (existing) {
        if (metadata?.request_digest !== digest) throw new IdempotencyConflictError();
        const accepted = this.findByClientMessageId(`branch:${input.client_branch_id}`, ownerId);
        if (!accepted || accepted.chat.id !== existing.id) throw new IdempotencyConflictError();
        this.#sqlite.exec("COMMIT");
        return { ...accepted, duplicate: true };
      }
      if (
        this.#sqlite.prepare("SELECT 1 FROM general_chats WHERE id=?").get(input.client_branch_id)
      )
        throw new IdempotencyConflictError();
      if (this.findByClientMessageId(`branch:${input.client_branch_id}`, ownerId))
        throw new IdempotencyConflictError();
      if (
        this.#sqlite
          .prepare(
            "SELECT 1 FROM general_chat_runs WHERE chat_id=? AND status IN ('queued','running')"
          )
          .get(chatId)
      )
        throw new GeneralChatBusyError();
      const selected = this.#sqlite
        .prepare(
          `SELECT rowid AS position,${MESSAGE_COLUMNS} FROM general_chat_messages WHERE chat_id=? AND id=?`
        )
        .get(chatId, input.message_id) as SqlRow | undefined;
      if (!selected) {
        this.#sqlite.exec("COMMIT");
        return null;
      }
      const source = asMessage(selected);
      let pivot = selected;
      if (input.kind === "regenerate") {
        if (source.role !== "assistant")
          throw new ChatBranchValidationError("Выберите ответ ассистента.");
        const user = this.#sqlite
          .prepare(
            `SELECT rowid AS position,${MESSAGE_COLUMNS} FROM general_chat_messages WHERE chat_id=? AND role='user' AND rowid<? ORDER BY rowid DESC LIMIT 1`
          )
          .get(chatId, Number(selected.position)) as SqlRow | undefined;
        if (!user) throw new ChatBranchValidationError("Не найден исходный запрос.");
        pivot = user;
      } else if (
        source.role !== "user" ||
        !input.content.trim() ||
        input.content.length > 100_000
      ) {
        throw new ChatBranchValidationError("Выберите непустой запрос пользователя.");
      }
      const family = this.listChatBranches(chatId, ownerId)!;
      if (family.items.length >= 33)
        throw new ChatBranchValidationError("В этой переписке уже 32 варианта. Начните новый чат.");
      const size = this.#sqlite
        .prepare(
          `SELECT count(*) AS n,coalesce(sum(length(CAST(content AS BLOB))+length(CAST(attachments_json AS BLOB))+1000),0) AS bytes FROM general_chat_messages WHERE chat_id=? AND rowid<?`
        )
        .get(chatId, Number(pivot.position)) as { n: number; bytes: number };
      if (size.n > 400 || size.bytes > 8 * 1024 * 1024)
        throw new ChatBranchValidationError(
          "Слишком большая история для варианта. Начните новый чат с нужной выборкой."
        );
      const prefix = this.#sqlite
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages WHERE chat_id=? AND rowid<? ORDER BY rowid`
        )
        .all(chatId, Number(pivot.position))
        .map((row) => asMessage(row as SqlRow));
      const original = asMessage(pivot);
      const content = input.kind === "edit" ? input.content : original.content;
      const attachments = original.attachments ?? [];
      const bytes = Buffer.byteLength(
        JSON.stringify([...prefix, { content, attachments }]),
        "utf8"
      );
      if (prefix.length > 400 || bytes > 8 * 1024 * 1024)
        throw new ChatBranchValidationError(
          "Слишком большая история для варианта. Начните новый чат с нужной выборкой."
        );
      const createdAt = timestamp();
      const stem =
        prefix.length === 0 ? titleFor(content) : parent.title.replace(/ · вариант \d+$/u, "");
      const title = `${stem.slice(0, 130)} · вариант ${family.items.length}`;
      this.#sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,mode,created_at,updated_at) VALUES(?,?,?,?,?,?)"
        )
        .run(input.client_branch_id, ownerId, title, parent.mode, createdAt, createdAt);
      const copy = this.#sqlite.prepare(
        `INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,attachments_json,status,run_id,error_code,created_at,updated_at)
         VALUES(?,?,?,?,'text',?,?,?,NULL,?,?,?)`
      );
      const copiedIds = new Map(prefix.map((message) => [message.id, randomUUID()]));
      for (const message of prefix)
        copy.run(
          copiedIds.get(message.id)!,
          input.client_branch_id,
          ownerId,
          message.role,
          message.content,
          JSON.stringify(message.attachments ?? []),
          message.status,
          message.error_code,
          message.created_at,
          message.updated_at
        );
      this.workspace.copySelection(chatId, input.client_branch_id, ownerId, copiedIds);
      this.skills.copy(chatId, input.client_branch_id, ownerId);
      const memory = this.getChatMemory(chatId, ownerId);
      if (memory?.memory_notes)
        this.#sqlite
          .prepare(
            "INSERT INTO chat_memory_notes(chat_id,memory_notes,version,updated_at) VALUES(?,?,1,?)"
          )
          .run(input.client_branch_id, memory.memory_notes, createdAt);
      this.#sqlite
        .prepare(
          `INSERT INTO kosmora_chat_preferences(chat_id,owner_id,relay_enabled)
         SELECT ?,owner_id,relay_enabled FROM kosmora_chat_preferences WHERE chat_id=? AND owner_id=?`
        )
        .run(input.client_branch_id, chatId, ownerId);
      const accepted = this.#insertMessage(
        input.client_branch_id,
        content,
        `branch:${input.client_branch_id}`,
        createdAt,
        ownerId,
        attachments
      );
      this.#sqlite
        .prepare(
          "INSERT INTO chat_branches(chat_id,parent_chat_id,root_chat_id,source_message_id,kind,request_digest) VALUES(?,?,?,?,?,?)"
        )
        .run(
          input.client_branch_id,
          chatId,
          family.root_chat_id,
          input.message_id,
          input.kind,
          digest
        );
      this.#sqlite.exec("COMMIT");
      return { ...accepted, duplicate: false };
    } catch (cause) {
      this.#sqlite.exec("ROLLBACK");
      throw cause;
    }
  }

  deleteChat(chatId: string, ownerId: string): boolean {
    if (!this.getChat(chatId, ownerId)) return false;
    if (
      this.#sqlite
        .prepare(
          "SELECT 1 FROM general_chat_runs WHERE chat_id=? AND status IN ('queued','running')"
        )
        .get(chatId)
    )
      throw new GeneralChatBusyError();
    this.#sqlite
      .prepare("DELETE FROM general_chats WHERE id=? AND owner_id=?")
      .run(chatId, ownerId);
    return true;
  }

  createChat(
    initialMessage: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID,
    attachments: ChatAttachment[] = [],
    mode: StoredGeneralChat["mode"] = "kosmora"
  ): AcceptedGeneralChatMessage {
    assertAttachments(attachments);
    if (!["kosmora", "work", "coscode"].includes(mode)) throw new Error("Invalid chat mode");
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (
        existing.chat.mode !== mode ||
        existing.userMessage.content !== initialMessage ||
        !sameAttachments(existing.userMessage, attachments)
      )
        throw new IdempotencyConflictError();
      return { ...existing, duplicate: true };
    }

    const chatId = randomUUID();
    const createdAt = timestamp();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          "INSERT INTO general_chats (id, owner_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(chatId, ownerId, titleFor(initialMessage), mode, createdAt, createdAt);
      const accepted = this.#insertMessage(
        chatId,
        initialMessage,
        clientMessageId,
        createdAt,
        ownerId,
        attachments
      );
      this.#sqlite.exec("COMMIT;");
      return { ...accepted, duplicate: false };
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  createMessage(
    chatId: string,
    content: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID,
    attachments: ChatAttachment[] = []
  ): AcceptedGeneralChatMessage | null {
    assertAttachments(attachments);
    const chat = this.getChat(chatId, ownerId);
    if (!chat) return null;
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (
        existing.chat.id !== chatId ||
        existing.userMessage.content !== content ||
        !sameAttachments(existing.userMessage, attachments)
      ) {
        throw new IdempotencyConflictError();
      }
      return { ...existing, duplicate: true };
    }
    const active = this.#sqlite
      .prepare(
        "SELECT 1 AS present FROM general_chat_runs WHERE chat_id = ? AND status IN ('queued', 'running') LIMIT 1"
      )
      .get(chatId) as { present?: number } | undefined;
    if (active) throw new GeneralChatBusyError();

    const createdAt = timestamp();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const accepted = this.#insertMessage(
        chatId,
        content,
        clientMessageId,
        createdAt,
        ownerId,
        attachments
      );
      this.#sqlite
        .prepare("UPDATE general_chats SET updated_at = ? WHERE id = ?")
        .run(createdAt, chatId);
      this.#sqlite.exec("COMMIT;");
      return { ...accepted, chat: { ...chat, updated_at: createdAt }, duplicate: false };
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  #insertMessage(
    chatId: string,
    content: string,
    clientMessageId: string,
    createdAt: string,
    ownerId: string,
    attachments: ChatAttachment[]
  ): Omit<AcceptedGeneralChatMessage, "duplicate"> {
    const runId = randomUUID();
    const messageId = randomUUID();
    this.#sqlite
      .prepare(
        "INSERT INTO general_chat_runs (id, chat_id, status, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?)"
      )
      .run(runId, chatId, createdAt, createdAt);
    this.#sqlite
      .prepare(
        `INSERT INTO general_chat_messages
          (id, chat_id, owner_id, role, content_type, content, attachments_json, status, client_message_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'text', ?, ?, 'completed', ?, ?, ?, ?)`
      )
      .run(
        messageId,
        chatId,
        ownerId,
        content,
        JSON.stringify(attachments),
        clientMessageId,
        runId,
        createdAt,
        createdAt
      );
    this.skills.snapshotRun(runId, chatId, ownerId);
    const chat = this.getChat(chatId, ownerId);
    const userMessage = this.#sqlite
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages WHERE id = ?`)
      .get(messageId) as SqlRow | undefined;
    const run = this.#sqlite
      .prepare(`SELECT ${RUN_COLUMNS} FROM general_chat_runs WHERE id = ?`)
      .get(runId) as SqlRow | undefined;
    if (!chat || !userMessage || !run) throw new Error("General chat message was not persisted");
    return { chat, userMessage: asMessage(userMessage), run: asRun(run) };
  }

  findByClientMessageId(
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID
  ): Omit<AcceptedGeneralChatMessage, "duplicate"> | null {
    const row = this.#sqlite
      .prepare(
        `SELECT m.id, m.chat_id, m.role, m.content_type, m.content, m.attachments_json, m.status,
          m.run_id, m.error_code, m.created_at, m.updated_at
         FROM general_chat_messages m
         JOIN general_chats c ON c.id = m.chat_id
         WHERE m.client_message_id = ? AND m.owner_id = ? AND c.owner_id = ?`
      )
      .get(clientMessageId, ownerId, ownerId) as SqlRow | undefined;
    if (!row) return null;
    const userMessage = asMessage(row);
    const chat = this.getChat(userMessage.chat_id, ownerId);
    const run = userMessage.run_id ? this.getRun(userMessage.run_id, ownerId) : null;
    if (!chat || !run) throw new Error("General chat idempotency record is incomplete");
    return { chat, userMessage, run };
  }

  getRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatRun | null {
    const row = this.#sqlite
      .prepare(
        `SELECT r.id, r.chat_id, r.status, r.provider, r.model_resolved,
          r.input_tokens, r.output_tokens, r.created_at, r.updated_at
         FROM general_chat_runs r JOIN general_chats c ON c.id = r.chat_id
         WHERE r.id = ? AND c.owner_id = ?`
      )
      .get(runId, ownerId) as SqlRow | undefined;
    return row ? asRun(row) : null;
  }

  getConversationForRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatMessage[] {
    const run = this.getRun(runId, ownerId);
    if (!run) return [];
    const messages = this.#sqlite
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages
         WHERE chat_id = ? AND rowid <= (
           SELECT rowid FROM general_chat_messages WHERE run_id = ? AND role = 'user' LIMIT 1
         ) ORDER BY rowid ASC`
      )
      .all(run.chat_id, runId)
      .map((row) => asMessage(row as SqlRow));
    return this.workspace.applyContext(run.chat_id, ownerId, messages);
  }

  /** Search by the actual user question, not a summary prepended to the projected conversation. */
  recallForRun(
    runId: string,
    ownerId: string,
    recentMessageIds: readonly string[]
  ): ContextMemoryBundle | undefined {
    const message = this.#sqlite
      .prepare(
        "SELECT m.chat_id,m.content FROM general_chat_messages m JOIN general_chats c ON c.id=m.chat_id AND c.owner_id=m.owner_id " +
          "JOIN general_chat_runs r ON r.id=m.run_id AND r.chat_id=c.id WHERE m.run_id=? AND m.role='user' AND c.owner_id=?"
      )
      .get(runId, ownerId) as { chat_id: string; content: string } | undefined;
    return message
      ? this.contextMemory.resolve(
          { kind: "chat", id: message.chat_id },
          ownerId,
          message.content,
          recentMessageIds
        )
      : undefined;
  }

  getAssistantMessage(runId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatMessage | null {
    if (!this.getRun(runId, ownerId)) return null;
    const row = this.#sqlite
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages WHERE run_id = ? AND role = 'assistant'`
      )
      .get(runId) as SqlRow | undefined;
    return row ? asMessage(row) : null;
  }

  startAssistantMessage(runId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatMessage | null {
    const run = this.getRun(runId, ownerId);
    if (!run) return null;
    const existing = this.getAssistantMessage(runId, ownerId);
    if (existing) return existing;
    const createdAt = timestamp();
    const messageId = randomUUID();
    this.#sqlite
      .prepare(
        `INSERT INTO general_chat_messages
          (id, chat_id, owner_id, role, content_type, content, status, run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'assistant', 'text', '', 'streaming', ?, ?, ?)`
      )
      .run(messageId, run.chat_id, ownerId, runId, createdAt, createdAt);
    this.#sqlite
      .prepare("UPDATE general_chat_runs SET status = 'running', updated_at = ? WHERE id = ?")
      .run(createdAt, runId);
    const row = this.#sqlite
      .prepare(`SELECT ${MESSAGE_COLUMNS} FROM general_chat_messages WHERE id = ?`)
      .get(messageId) as SqlRow | undefined;
    return row ? asMessage(row) : null;
  }

  appendAssistantDelta(messageId: string, delta: string): void {
    this.#sqlite
      .prepare(
        "UPDATE general_chat_messages SET content = content || ?, updated_at = ? WHERE id = ?"
      )
      .run(delta, timestamp(), messageId);
  }

  reserveModelUsage(
    runId: string,
    reservation: ModelUsageReservation,
    ownerId = LOCAL_OWNER_ID
  ): StoredGeneralChatUsage | null {
    const run = this.getRun(runId, ownerId);
    if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return null;
    const existing = this.#sqlite
      .prepare(
        `SELECT ${USAGE_COLUMNS} FROM general_chat_model_usage WHERE run_id = ? AND attempt = ?`
      )
      .get(runId, reservation.attempt) as SqlRow | undefined;
    if (existing) {
      const usage = asUsage(existing);
      if (
        usage.registry_version !== reservation.registry_version ||
        usage.provider_id !== reservation.provider_id ||
        usage.model_requested !== reservation.model_id
      ) {
        throw new ModelUsageConflictError();
      }
      return usage;
    }
    const createdAt = timestamp();
    const usageId = randomUUID();
    this.#sqlite
      .prepare(
        `INSERT INTO general_chat_model_usage
          (usage_id, run_id, chat_id, attempt, status, registry_version, provider_id,
           model_requested, estimated_input_tokens, max_output_tokens, estimated_cost_amount,
           currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        usageId,
        runId,
        run.chat_id,
        reservation.attempt,
        reservation.registry_version,
        reservation.provider_id,
        reservation.model_id,
        reservation.estimated_input_tokens,
        reservation.max_output_tokens,
        reservation.estimated_cost?.amount ?? null,
        reservation.estimated_cost?.currency ?? null,
        createdAt,
        createdAt
      );
    const inserted = this.#sqlite
      .prepare(`SELECT ${USAGE_COLUMNS} FROM general_chat_model_usage WHERE usage_id = ?`)
      .get(usageId) as SqlRow | undefined;
    if (!inserted) throw new Error("General chat usage reservation was not persisted");
    return asUsage(inserted);
  }

  getModelUsageForRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredGeneralChatUsage[] {
    if (!this.getRun(runId, ownerId)) return [];
    return this.#sqlite
      .prepare(
        `SELECT ${USAGE_COLUMNS} FROM general_chat_model_usage WHERE run_id = ? ORDER BY attempt ASC`
      )
      .all(runId) as unknown as StoredGeneralChatUsage[];
  }

  failModelUsage(runId: string, attempt: number, errorCode: string): void {
    this.#sqlite
      .prepare(
        `UPDATE general_chat_model_usage SET status = 'failed', error_code = ?, updated_at = ?
         WHERE run_id = ? AND attempt = ? AND status = 'reserved'`
      )
      .run(errorCode, timestamp(), runId, attempt);
  }

  /** Canonical billing can finish before a downstream translation or message does. */
  commitModelUsage(
    runId: string,
    provider: string,
    model: string,
    usage: { inputTokens: number | null; outputTokens: number | null },
    accounting: { attempt: number; calculatedCost: { amount: number; currency: Currency } | null }
  ): void {
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.persistModelUsage(runId, provider, model, usage, accounting, timestamp());
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  private persistModelUsage(
    runId: string,
    provider: string,
    model: string,
    usage: { inputTokens: number | null; outputTokens: number | null },
    accounting: { attempt: number; calculatedCost: { amount: number; currency: Currency } | null },
    at: string
  ): void {
    const counter = (value: number | null) =>
      value === null || (Number.isSafeInteger(value) && value >= 0);
    const cost = accounting.calculatedCost;
    if (
      !counter(usage.inputTokens) ||
      !counter(usage.outputTokens) ||
      (usage.inputTokens !== null &&
        usage.outputTokens !== null &&
        !Number.isSafeInteger(usage.inputTokens + usage.outputTokens)) ||
      (cost !== null &&
        (!Number.isFinite(cost.amount) ||
          cost.amount < 0 ||
          !["USD", "RUB"].includes(cost.currency)))
    )
      throw new ModelUsageConflictError();
    const existing = this.#sqlite
      .prepare(`SELECT ${USAGE_COLUMNS} FROM general_chat_model_usage WHERE run_id=? AND attempt=?`)
      .get(runId, accounting.attempt) as unknown as StoredGeneralChatUsage | undefined;
    if (!existing || existing.provider_id !== provider || !model.trim())
      throw new ModelUsageConflictError();
    const currency = cost?.currency ?? existing.currency;
    if (existing.status === "committed") {
      if (
        existing.model_resolved !== model ||
        existing.actual_input_tokens !== usage.inputTokens ||
        existing.actual_output_tokens !== usage.outputTokens ||
        existing.calculated_cost_amount !== (cost?.amount ?? null) ||
        existing.currency !== currency
      )
        throw new ModelUsageConflictError();
      return;
    }
    if (existing.status !== "reserved") throw new ModelUsageConflictError();
    this.#sqlite
      .prepare(
        `UPDATE general_chat_model_usage SET status='committed',model_resolved=?,
         actual_input_tokens=?,actual_output_tokens=?,calculated_cost_amount=?,currency=?,updated_at=?
         WHERE run_id=? AND attempt=? AND status='reserved'`
      )
      .run(
        model,
        usage.inputTokens,
        usage.outputTokens,
        cost?.amount ?? null,
        currency,
        at,
        runId,
        accounting.attempt
      );
    this.#sqlite
      .prepare(
        `UPDATE general_chat_runs SET provider=?,model_resolved=?,input_tokens=?,output_tokens=?,updated_at=?
         WHERE id=? AND status IN ('queued','running')`
      )
      .run(provider, model, usage.inputTokens, usage.outputTokens, at, runId);
  }

  completeRun(
    runId: string,
    provider: string,
    model: string,
    usage: { inputTokens: number | null; outputTokens: number | null },
    accounting: { attempt: number; calculatedCost: { amount: number; currency: Currency } | null }
  ): void {
    const completedAt = timestamp();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.persistModelUsage(runId, provider, model, usage, accounting, completedAt);
      const runResult = this.#sqlite
        .prepare(
          `UPDATE general_chat_runs SET status = 'succeeded', provider = ?, model_resolved = ?,
            input_tokens = ?, output_tokens = ?, updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(provider, model, usage.inputTokens, usage.outputTokens, completedAt, runId);
      if (Number(runResult.changes) === 0) {
        this.#sqlite.exec("COMMIT;");
        return;
      }
      this.#sqlite
        .prepare(
          `UPDATE general_chat_messages SET status = 'completed', updated_at = ?
           WHERE run_id = ? AND role = 'assistant' AND status IN ('pending', 'streaming')`
        )
        .run(completedAt, runId);
      this.#sqlite
        .prepare(
          "UPDATE general_chats SET updated_at = ? WHERE id = (SELECT chat_id FROM general_chat_runs WHERE id = ?)"
        )
        .run(completedAt, runId);
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  failRun(runId: string, errorCode: string): void {
    const failedAt = timestamp();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE general_chat_runs SET status = 'failed', updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(failedAt, runId);
      this.#sqlite
        .prepare(
          `UPDATE general_chat_messages SET status = 'failed', error_code = ?, updated_at = ?
           WHERE run_id = ? AND role = 'assistant' AND status IN ('pending', 'streaming')`
        )
        .run(errorCode, failedAt, runId);
      this.#sqlite
        .prepare(
          `UPDATE general_chat_model_usage SET status = 'failed', error_code = ?, updated_at = ?
           WHERE run_id = ? AND status = 'reserved'`
        )
        .run(errorCode, failedAt, runId);
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  cancelRun(runId: string, ownerId = LOCAL_OWNER_ID): "cancelled" | "finished" | null {
    const run = this.getRun(runId, ownerId);
    if (!run) return null;
    if (run.status === "cancelled") return "cancelled";
    if (run.status === "succeeded" || run.status === "failed") return "finished";
    const cancelledAt = timestamp();
    const assistant = this.getAssistantMessage(runId, ownerId);
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      if (assistant) {
        this.#sqlite
          .prepare(
            `UPDATE general_chat_messages SET status = 'cancelled', error_code = 'CANCELLED_BY_OWNER', updated_at = ?
             WHERE id = ? AND status IN ('pending', 'streaming')`
          )
          .run(cancelledAt, assistant.id);
      } else {
        this.#sqlite
          .prepare(
            `INSERT INTO general_chat_messages
              (id, chat_id, owner_id, role, content_type, content, status, run_id, error_code, created_at, updated_at)
             VALUES (?, ?, ?, 'assistant', 'text', '', 'cancelled', ?, 'CANCELLED_BY_OWNER', ?, ?)`
          )
          .run(randomUUID(), run.chat_id, ownerId, runId, cancelledAt, cancelledAt);
      }
      this.#sqlite
        .prepare(
          `UPDATE general_chat_runs SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(cancelledAt, runId);
      this.#sqlite
        .prepare(
          `UPDATE general_chat_model_usage SET status = 'cancelled', error_code = 'CANCELLED_BY_OWNER', updated_at = ?
           WHERE run_id = ? AND status = 'reserved'`
        )
        .run(cancelledAt, runId);
      this.#sqlite.exec("COMMIT;");
      return "cancelled";
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  recoverInterruptedRuns(errorCode = "INTERRUPTED_BY_RESTART"): number {
    const failedAt = timestamp();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE general_chat_messages SET status = 'failed', error_code = ?, updated_at = ?
           WHERE role = 'assistant' AND status = 'streaming'
             AND run_id IN (SELECT id FROM general_chat_runs WHERE status = 'running')`
        )
        .run(errorCode, failedAt);
      this.#sqlite
        .prepare(
          `UPDATE general_chat_model_usage SET status = 'failed', error_code = ?, updated_at = ?
           WHERE status = 'reserved'
             AND run_id IN (SELECT id FROM general_chat_runs WHERE status = 'running')`
        )
        .run(errorCode, failedAt);
      const result = this.#sqlite
        .prepare(
          `UPDATE general_chat_runs SET status = 'failed', updated_at = ? WHERE status = 'running'`
        )
        .run(failedAt);
      this.#sqlite.exec("COMMIT;");
      return Number(result.changes);
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }
}
