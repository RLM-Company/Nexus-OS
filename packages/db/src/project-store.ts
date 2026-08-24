import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

export const LOCAL_OWNER_ID = "local-owner";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for another request");
    this.name = "IdempotencyConflictError";
  }
}

export interface StoredProject {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "FAILED" | "ARCHIVED";
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  project_id: string;
  chat_id: string;
  role: "user" | "assistant" | "system_event";
  content_type: "text";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  reply_to_message_id: string | null;
  run_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredRun {
  id: string;
  project_id: string;
  chat_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  provider: string | null;
  model_resolved: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export interface AcceptedMessage {
  project: StoredProject;
  chatId: string;
  userMessage: StoredMessage;
  run: StoredRun;
  duplicate: boolean;
}

type SqlRow = Record<string, unknown>;

const asProject = (row: SqlRow): StoredProject => row as unknown as StoredProject;
const asMessage = (row: SqlRow): StoredMessage => row as unknown as StoredMessage;
const asRun = (row: SqlRow): StoredRun => row as unknown as StoredRun;
const now = (): string => new Date().toISOString();

const projectTitle = (message: string): string => {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 58 ? `${normalized.slice(0, 57)}…` : normalized;
};

export class ProjectStore {
  readonly #sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.#sqlite = sqlite;
  }

  #get(statement: StatementSync, ...values: string[]): SqlRow | undefined {
    return statement.get(...values);
  }

  listProjects(
    ownerId = LOCAL_OWNER_ID
  ): Array<StoredProject & { last_message_preview: string | null }> {
    return this.#sqlite
      .prepare(
        `SELECT p.id, p.title, p.status, p.created_at, p.updated_at,
          (SELECT substr(content, 1, 240) FROM messages m
            WHERE m.project_id = p.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1)
            AS last_message_preview
         FROM projects p
         WHERE p.owner_id = ?
         ORDER BY p.updated_at DESC`
      )
      .all(ownerId) as unknown as Array<StoredProject & { last_message_preview: string | null }>;
  }

  getProject(projectId: string, ownerId = LOCAL_OWNER_ID): StoredProject | null {
    const row = this.#get(
      this.#sqlite.prepare(
        "SELECT id, title, status, created_at, updated_at FROM projects WHERE id = ? AND owner_id = ?"
      ),
      projectId,
      ownerId
    );
    return row ? asProject(row) : null;
  }

  getMainChatId(projectId: string, ownerId = LOCAL_OWNER_ID): string | null {
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT c.id FROM chats c
         JOIN projects p ON p.id = c.project_id
         WHERE c.project_id = ? AND c.kind = 'main' AND p.owner_id = ?`
      ),
      projectId,
      ownerId
    );
    return typeof row?.id === "string" ? row.id : null;
  }

  listMessages(projectId: string, ownerId = LOCAL_OWNER_ID): StoredMessage[] {
    return this.#sqlite
      .prepare(
        `SELECT m.id, m.project_id, m.chat_id, m.role, m.content_type, m.content, m.status,
          m.reply_to_message_id, m.run_id, m.error_code, m.created_at, m.updated_at
         FROM messages m
         JOIN projects p ON p.id = m.project_id
         WHERE m.project_id = ? AND p.owner_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`
      )
      .all(projectId, ownerId) as unknown as StoredMessage[];
  }

  createProject(
    initialMessage: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID
  ): AcceptedMessage {
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (existing.userMessage.content !== initialMessage) throw new IdempotencyConflictError();
      return { ...existing, duplicate: true };
    }

    const projectId = randomUUID();
    const chatId = randomUUID();
    const timestamp = now();

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          "INSERT INTO projects (id, owner_id, title, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)"
        )
        .run(projectId, ownerId, projectTitle(initialMessage), timestamp, timestamp);
      this.#sqlite
        .prepare("INSERT INTO chats (id, project_id, kind, created_at) VALUES (?, ?, 'main', ?)")
        .run(chatId, projectId, timestamp);
      const accepted = this.#insertMessage(
        projectId,
        chatId,
        initialMessage,
        clientMessageId,
        timestamp,
        ownerId
      );
      this.#sqlite.exec("COMMIT;");
      return { ...accepted, duplicate: false };
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  createMessage(
    projectId: string,
    content: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID
  ): AcceptedMessage | null {
    const project = this.getProject(projectId, ownerId);
    if (!project) return null;
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (existing.project.id !== projectId || existing.userMessage.content !== content) {
        throw new IdempotencyConflictError();
      }
      return { ...existing, duplicate: true };
    }

    const chatId = this.getMainChatId(projectId, ownerId);
    if (!chatId) throw new Error(`Main chat is missing for project ${projectId}`);
    const timestamp = now();

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const accepted = this.#insertMessage(
        projectId,
        chatId,
        content,
        clientMessageId,
        timestamp,
        ownerId
      );
      this.#sqlite
        .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(timestamp, projectId);
      this.#sqlite.exec("COMMIT;");
      return { ...accepted, project: { ...project, updated_at: timestamp }, duplicate: false };
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  #insertMessage(
    projectId: string,
    chatId: string,
    content: string,
    clientMessageId: string,
    timestamp: string,
    ownerId: string
  ): Omit<AcceptedMessage, "duplicate"> {
    const userMessageId = randomUUID();
    const runId = randomUUID();
    this.#sqlite
      .prepare(
        "INSERT INTO runs (id, project_id, chat_id, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)"
      )
      .run(runId, projectId, chatId, timestamp, timestamp);
    this.#sqlite
      .prepare(
        `INSERT INTO messages
          (id, project_id, chat_id, role, content_type, content, status, client_message_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'text', ?, 'completed', ?, ?, ?, ?)`
      )
      .run(userMessageId, projectId, chatId, content, clientMessageId, runId, timestamp, timestamp);

    const project = this.getProject(projectId, ownerId);
    if (!project) throw new Error(`Project ${projectId} disappeared during message creation`);
    return {
      project,
      chatId,
      userMessage: asMessage(
        this.#get(
          this.#sqlite.prepare(
            `SELECT id, project_id, chat_id, role, content_type, content, status,
              reply_to_message_id, run_id, error_code, created_at, updated_at
             FROM messages WHERE id = ?`
          ),
          userMessageId
        ) ?? {}
      ),
      run: asRun(
        this.#get(
          this.#sqlite.prepare(
            `SELECT id, project_id, chat_id, status, provider, model_resolved,
              input_tokens, output_tokens, created_at, updated_at
             FROM runs WHERE id = ?`
          ),
          runId
        ) ?? {}
      )
    };
  }

  findByClientMessageId(
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID
  ): Omit<AcceptedMessage, "duplicate"> | null {
    const messageRow = this.#get(
      this.#sqlite.prepare(
        `SELECT m.id, m.project_id, m.chat_id, m.role, m.content_type, m.content, m.status,
          m.reply_to_message_id, m.run_id, m.error_code, m.created_at, m.updated_at
         FROM messages m
         JOIN projects p ON p.id = m.project_id
         WHERE m.client_message_id = ? AND p.owner_id = ?`
      ),
      clientMessageId,
      ownerId
    );
    if (!messageRow) return null;
    const message = asMessage(messageRow);
    const project = this.getProject(message.project_id, ownerId);
    const run = message.run_id ? this.getRun(message.run_id, ownerId) : null;
    if (!project || !run) throw new Error("Idempotency record is incomplete");
    return { project, chatId: message.chat_id, userMessage: message, run };
  }

  getRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredRun | null {
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT r.id, r.project_id, r.chat_id, r.status, r.provider, r.model_resolved,
          r.input_tokens, r.output_tokens, r.created_at, r.updated_at
         FROM runs r
         JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND p.owner_id = ?`
      ),
      runId,
      ownerId
    );
    return row ? asRun(row) : null;
  }

  getRunPrompt(runId: string, ownerId = LOCAL_OWNER_ID): string | null {
    if (!this.getRun(runId, ownerId)) return null;
    const row = this.#get(
      this.#sqlite.prepare(
        "SELECT content FROM messages WHERE run_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
      ),
      runId
    );
    return typeof row?.content === "string" ? row.content : null;
  }

  getConversationForRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredMessage[] {
    const run = this.getRun(runId, ownerId);
    if (!run) return [];
    return this.#sqlite
      .prepare(
        `SELECT id, project_id, chat_id, role, content_type, content, status,
          reply_to_message_id, run_id, error_code, created_at, updated_at
         FROM messages
         WHERE project_id = ?
           AND rowid <= (
             SELECT rowid FROM messages WHERE run_id = ? AND role = 'user' LIMIT 1
           )
         ORDER BY rowid ASC`
      )
      .all(run.project_id, runId) as unknown as StoredMessage[];
  }

  getAssistantMessage(runId: string, ownerId = LOCAL_OWNER_ID): StoredMessage | null {
    if (!this.getRun(runId, ownerId)) return null;
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT id, project_id, chat_id, role, content_type, content, status,
          reply_to_message_id, run_id, error_code, created_at, updated_at
         FROM messages WHERE run_id = ? AND role = 'assistant'`
      ),
      runId
    );
    return row ? asMessage(row) : null;
  }

  startAssistantMessage(runId: string): StoredMessage | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const existing = this.getAssistantMessage(runId);
    if (existing) return existing;

    const timestamp = now();
    const id = randomUUID();
    this.#sqlite
      .prepare(
        `INSERT INTO messages
          (id, project_id, chat_id, role, content_type, content, status, run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'assistant', 'text', '', 'streaming', ?, ?, ?)`
      )
      .run(id, run.project_id, run.chat_id, runId, timestamp, timestamp);
    this.#sqlite
      .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ?")
      .run(timestamp, runId);
    return asMessage(
      this.#get(
        this.#sqlite.prepare(
          `SELECT id, project_id, chat_id, role, content_type, content, status,
            reply_to_message_id, run_id, error_code, created_at, updated_at
           FROM messages WHERE id = ?`
        ),
        id
      ) ?? {}
    );
  }

  appendAssistantDelta(messageId: string, delta: string): void {
    this.#sqlite
      .prepare("UPDATE messages SET content = content || ?, updated_at = ? WHERE id = ?")
      .run(delta, now(), messageId);
  }

  completeRun(
    runId: string,
    provider: string,
    model: string,
    usage?: { inputTokens: number; outputTokens: number }
  ): void {
    const timestamp = now();
    this.#sqlite
      .prepare(
        "UPDATE messages SET status = 'completed', updated_at = ? WHERE run_id = ? AND role = 'assistant'"
      )
      .run(timestamp, runId);
    this.#sqlite
      .prepare(
        `UPDATE runs SET status = 'succeeded', provider = ?, model_resolved = ?,
          input_tokens = ?, output_tokens = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        provider,
        model,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        timestamp,
        runId
      );
    const run = this.getRun(runId);
    if (run) {
      this.#sqlite
        .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(timestamp, run.project_id);
    }
  }

  failRun(runId: string, errorCode: string): void {
    const timestamp = now();
    this.#sqlite
      .prepare(
        "UPDATE messages SET status = 'failed', error_code = ?, updated_at = ? WHERE run_id = ? AND role = 'assistant'"
      )
      .run(errorCode, timestamp, runId);
    this.#sqlite
      .prepare("UPDATE runs SET status = 'failed', updated_at = ? WHERE id = ?")
      .run(timestamp, runId);
  }

  cancelRun(runId: string, ownerId = LOCAL_OWNER_ID): "cancelled" | "finished" | null {
    const run = this.getRun(runId, ownerId);
    if (!run) return null;
    if (run.status === "cancelled") return "cancelled";
    if (run.status === "succeeded" || run.status === "failed") return "finished";

    const timestamp = now();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE messages SET status = 'cancelled', error_code = 'CANCELLED_BY_OWNER', updated_at = ?
           WHERE run_id = ? AND role = 'assistant' AND status IN ('pending', 'streaming')`
        )
        .run(timestamp, runId);
      this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(timestamp, runId);
      this.#sqlite.exec("COMMIT;");
      return "cancelled";
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  recoverInterruptedRuns(errorCode = "INTERRUPTED_BY_RESTART"): number {
    const timestamp = now();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE messages SET status = 'failed', error_code = ?, updated_at = ?
           WHERE role = 'assistant' AND status = 'streaming'
             AND run_id IN (SELECT id FROM runs WHERE status = 'running')`
        )
        .run(errorCode, timestamp);
      const result = this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'failed', updated_at = ?
           WHERE status = 'running'`
        )
        .run(timestamp);
      this.#sqlite.exec("COMMIT;");
      return Number(result.changes);
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }
}
