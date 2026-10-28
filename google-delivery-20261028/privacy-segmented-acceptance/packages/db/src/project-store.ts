import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  sameChatAttachments,
  isValidChatAttachments,
  attachmentContextSize,
  type ChatAttachment,
  type ChatTextAttachment,
  type Currency
} from "@cosmora/contracts";

export const LOCAL_OWNER_ID = "local-owner";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for another request");
    this.name = "IdempotencyConflictError";
  }
}

export class ModelUsageConflictError extends Error {
  constructor() {
    super("Model usage attempt was already reserved for another route");
    this.name = "ModelUsageConflictError";
  }
}

export type ProjectUsageLimitFailureCode =
  "PROJECT_TOKEN_LIMIT_EXCEEDED" | "PROJECT_COST_LIMIT_EXCEEDED" | "PROJECT_USAGE_EVIDENCE_MISSING";

export class ProjectUsageLimitExceededError extends Error {
  readonly code: ProjectUsageLimitFailureCode;

  constructor(code: ProjectUsageLimitFailureCode) {
    super(`Project usage reservation denied: ${code}`);
    this.name = "ProjectUsageLimitExceededError";
    this.code = code;
  }
}

export interface StoredProject {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "FAILED" | "ARCHIVED";
  created_at: string;
  updated_at: string;
}

export interface ProjectMaterials {
  project_id: string;
  version: number;
  instructions: string;
  attachments: ChatTextAttachment[];
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  project_id: string;
  chat_id: string;
  role: "user" | "assistant" | "system_event";
  content_type: "text";
  content: string;
  attachments?: ChatAttachment[];
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

export interface ModelUsageReservation {
  attempt: number;
  registry_version: string;
  provider_id: string;
  model_id: string;
  estimated_input_tokens: number;
  max_output_tokens: number;
  estimated_cost: { amount: number; currency: Currency } | null;
}

export interface StoredModelUsage {
  usage_id: string;
  run_id: string;
  project_id: string;
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

export interface AcceptedMessage {
  project: StoredProject;
  chatId: string;
  userMessage: StoredMessage;
  run: StoredRun;
  duplicate: boolean;
}

type SqlRow = Record<string, unknown>;

const asProject = (row: SqlRow): StoredProject => row as unknown as StoredProject;
const asMessage = (row: SqlRow): StoredMessage => {
  const { attachments_json, ...message } = row;
  const attachments =
    typeof attachments_json === "string" ? (JSON.parse(attachments_json) as ChatAttachment[]) : [];
  return { ...message, ...(attachments.length ? { attachments } : {}) } as unknown as StoredMessage;
};
const asRun = (row: SqlRow): StoredRun => row as unknown as StoredRun;
const asModelUsage = (row: SqlRow): StoredModelUsage => row as unknown as StoredModelUsage;
const now = (): string => new Date().toISOString();

const finiteNonNegative = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

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

  getMaterials(projectId: string, ownerId = LOCAL_OWNER_ID): ProjectMaterials | null {
    const project = this.getProject(projectId, ownerId);
    if (!project) return null;
    const row = this.#sqlite
      .prepare(
        "SELECT version, instructions, attachments_json, updated_at FROM project_materials WHERE project_id = ?"
      )
      .get(projectId);
    return row
      ? {
          project_id: projectId,
          version: Number(row.version),
          instructions: String(row.instructions),
          attachments: JSON.parse(String(row.attachments_json)) as ChatTextAttachment[],
          updated_at: String(row.updated_at)
        }
      : {
          project_id: projectId,
          version: 0,
          instructions: "",
          attachments: [],
          updated_at: project.created_at
        };
  }

  setMaterials(
    projectId: string,
    ownerId: string,
    input: { version: number; instructions: string; attachments: ChatTextAttachment[] }
  ): ProjectMaterials | null {
    if (
      input.instructions.length > 4000 ||
      !isValidChatAttachments(input.attachments) ||
      input.attachments.some((file) => !("content" in file)) ||
      new TextEncoder().encode(input.instructions).length +
        input.attachments.reduce((sum, file) => sum + attachmentContextSize(file), 0) >
        24000
    )
      throw new Error("Invalid project materials");
    this.#sqlite.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getMaterials(projectId, ownerId);
      if (!current) {
        this.#sqlite.exec("ROLLBACK");
        return null;
      }
      if (current.version !== input.version) throw new IdempotencyConflictError();
      this.#sqlite
        .prepare(
          "INSERT INTO project_materials (project_id, version, instructions, attachments_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET version = excluded.version, instructions = excluded.instructions, attachments_json = excluded.attachments_json, updated_at = excluded.updated_at"
        )
        .run(
          projectId,
          current.version + 1,
          input.instructions,
          JSON.stringify(input.attachments),
          now()
        );
      this.#sqlite.exec("COMMIT");
      return this.getMaterials(projectId, ownerId);
    } catch (error) {
      this.#sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  getMaterialsForRun(runId: string, ownerId = LOCAL_OWNER_ID): ProjectMaterials | null {
    if (!this.getRun(runId, ownerId)) return null;
    const row = this.#sqlite
      .prepare("SELECT project_materials_json FROM runs WHERE id = ?")
      .get(runId);
    const materials = JSON.parse(
      String(row?.project_materials_json ?? "{}")
    ) as Partial<ProjectMaterials>;
    return materials.project_id ? (materials as ProjectMaterials) : null;
  }

  listMessages(projectId: string, ownerId = LOCAL_OWNER_ID): StoredMessage[] {
    return this.#sqlite
      .prepare(
        `SELECT m.id, m.project_id, m.chat_id, m.role, m.content_type, m.content, m.attachments_json, m.status,
          m.reply_to_message_id, m.run_id, m.error_code, m.created_at, m.updated_at
         FROM messages m
         JOIN projects p ON p.id = m.project_id
         WHERE m.project_id = ? AND p.owner_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`
      )
      .all(projectId, ownerId)
      .map(asMessage);
  }

  createProject(
    initialMessage: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID,
    attachments: ChatAttachment[] = []
  ): AcceptedMessage {
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (
        existing.userMessage.content !== initialMessage ||
        !sameChatAttachments(existing.userMessage.attachments ?? [], attachments)
      )
        throw new IdempotencyConflictError();
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
    projectId: string,
    content: string,
    clientMessageId: string,
    ownerId = LOCAL_OWNER_ID,
    attachments: ChatAttachment[] = []
  ): AcceptedMessage | null {
    const project = this.getProject(projectId, ownerId);
    if (!project) return null;
    const existing = this.findByClientMessageId(clientMessageId, ownerId);
    if (existing) {
      if (
        existing.project.id !== projectId ||
        existing.userMessage.content !== content ||
        !sameChatAttachments(existing.userMessage.attachments ?? [], attachments)
      ) {
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
        ownerId,
        attachments
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
    ownerId: string,
    attachments: ChatAttachment[]
  ): Omit<AcceptedMessage, "duplicate"> {
    const userMessageId = randomUUID();
    const runId = randomUUID();
    this.#sqlite
      .prepare(
        "INSERT INTO runs (id, project_id, chat_id, status, project_materials_json, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)"
      )
      .run(
        runId,
        projectId,
        chatId,
        JSON.stringify(this.getMaterials(projectId, ownerId)),
        timestamp,
        timestamp
      );
    this.#sqlite
      .prepare(
        `INSERT INTO messages
          (id, project_id, chat_id, role, content_type, content, attachments_json, status, client_message_id, run_id, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 'text', ?, ?, 'completed', ?, ?, ?, ?)`
      )
      .run(
        userMessageId,
        projectId,
        chatId,
        content,
        JSON.stringify(attachments),
        clientMessageId,
        runId,
        timestamp,
        timestamp
      );

    const project = this.getProject(projectId, ownerId);
    if (!project) throw new Error(`Project ${projectId} disappeared during message creation`);
    return {
      project,
      chatId,
      userMessage: asMessage(
        this.#get(
          this.#sqlite.prepare(
            `SELECT id, project_id, chat_id, role, content_type, content, attachments_json, status,
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
        `SELECT m.id, m.project_id, m.chat_id, m.role, m.content_type, m.content, m.attachments_json, m.status,
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

  reserveModelUsage(
    runId: string,
    reservation: ModelUsageReservation,
    ownerId = LOCAL_OWNER_ID
  ): StoredModelUsage | null {
    const run = this.getRun(runId, ownerId);
    if (!run) return null;
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      return null;
    }

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.#sqlite
        .prepare(
          `SELECT usage_id, run_id, project_id, attempt, status, registry_version, provider_id,
            model_requested, model_resolved, estimated_input_tokens, max_output_tokens,
            estimated_cost_amount, actual_input_tokens, actual_output_tokens,
            calculated_cost_amount, currency, error_code, created_at, updated_at
           FROM model_usage_ledger WHERE run_id = ? AND attempt = ?`
        )
        .get(runId, reservation.attempt) as SqlRow | undefined;
      if (existing) {
        const stored = asModelUsage(existing);
        const sameRoute =
          stored.registry_version === reservation.registry_version &&
          stored.provider_id === reservation.provider_id &&
          stored.model_requested === reservation.model_id &&
          stored.estimated_input_tokens === reservation.estimated_input_tokens &&
          stored.max_output_tokens === reservation.max_output_tokens &&
          stored.estimated_cost_amount === (reservation.estimated_cost?.amount ?? null) &&
          stored.currency === (reservation.estimated_cost?.currency ?? null);
        if (!sameRoute) throw new ModelUsageConflictError();
        this.#sqlite.exec("COMMIT;");
        return stored;
      }

      const limit = this.#sqlite
        .prepare(
          `SELECT max_total_tokens, max_cost_amount, currency
           FROM project_usage_limits WHERE project_id = ? AND owner_id = ?`
        )
        .get(run.project_id, ownerId) as
        | {
            max_total_tokens: number | null;
            max_cost_amount: number | null;
            currency: Currency | null;
          }
        | undefined;
      if (limit && (limit.max_total_tokens !== null || limit.max_cost_amount !== null)) {
        const accounted = this.#sqlite
          .prepare(
            `SELECT usage_id, run_id, project_id, attempt, status, registry_version, provider_id,
              model_requested, model_resolved, estimated_input_tokens, max_output_tokens,
              estimated_cost_amount, actual_input_tokens, actual_output_tokens,
              calculated_cost_amount, currency, error_code, created_at, updated_at
             FROM model_usage_ledger
             WHERE project_id = ?`
          )
          .all(run.project_id) as unknown as StoredModelUsage[];

        if (limit.max_total_tokens !== null) {
          if (!Number.isInteger(limit.max_total_tokens) || limit.max_total_tokens < 1) {
            throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
          }
          let usedTokens = 0;
          for (const usage of accounted) {
            const input =
              usage.status === "committed"
                ? usage.actual_input_tokens
                : usage.estimated_input_tokens;
            const output =
              usage.status === "committed" ? usage.actual_output_tokens : usage.max_output_tokens;
            if (!finiteNonNegative(input) || !finiteNonNegative(output)) {
              throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
            }
            usedTokens += input + output;
          }
          if (
            !Number.isInteger(reservation.estimated_input_tokens) ||
            !Number.isInteger(reservation.max_output_tokens) ||
            reservation.estimated_input_tokens < 0 ||
            reservation.max_output_tokens < 1
          ) {
            throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
          }
          if (
            usedTokens + reservation.estimated_input_tokens + reservation.max_output_tokens >
            limit.max_total_tokens
          ) {
            throw new ProjectUsageLimitExceededError("PROJECT_TOKEN_LIMIT_EXCEEDED");
          }
        }

        if (limit.max_cost_amount !== null) {
          if (
            !finiteNonNegative(limit.max_cost_amount) ||
            limit.max_cost_amount === 0 ||
            (limit.currency !== "USD" && limit.currency !== "RUB")
          ) {
            throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
          }
          let usedCost = 0;
          for (const usage of accounted) {
            const amount =
              usage.status === "committed"
                ? usage.calculated_cost_amount
                : usage.estimated_cost_amount;
            if (!finiteNonNegative(amount) || usage.currency !== limit.currency) {
              throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
            }
            usedCost += amount;
          }
          if (
            !reservation.estimated_cost ||
            reservation.estimated_cost.currency !== limit.currency ||
            !finiteNonNegative(reservation.estimated_cost.amount)
          ) {
            throw new ProjectUsageLimitExceededError("PROJECT_USAGE_EVIDENCE_MISSING");
          }
          if (usedCost + reservation.estimated_cost.amount > limit.max_cost_amount) {
            throw new ProjectUsageLimitExceededError("PROJECT_COST_LIMIT_EXCEEDED");
          }
        }
      }

      const timestamp = now();
      const usageId = randomUUID();
      this.#sqlite
        .prepare(
          `INSERT INTO model_usage_ledger
            (usage_id, run_id, project_id, attempt, status, registry_version, provider_id,
             model_requested, estimated_input_tokens, max_output_tokens, estimated_cost_amount,
             currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          usageId,
          runId,
          run.project_id,
          reservation.attempt,
          reservation.registry_version,
          reservation.provider_id,
          reservation.model_id,
          reservation.estimated_input_tokens,
          reservation.max_output_tokens,
          reservation.estimated_cost?.amount ?? null,
          reservation.estimated_cost?.currency ?? null,
          timestamp,
          timestamp
        );
      const inserted = this.#sqlite
        .prepare(
          `SELECT usage_id, run_id, project_id, attempt, status, registry_version, provider_id,
            model_requested, model_resolved, estimated_input_tokens, max_output_tokens,
            estimated_cost_amount, actual_input_tokens, actual_output_tokens,
            calculated_cost_amount, currency, error_code, created_at, updated_at
           FROM model_usage_ledger WHERE usage_id = ?`
        )
        .get(usageId) as SqlRow | undefined;
      if (!inserted) throw new Error("Reserved model usage was not persisted");
      this.#sqlite.exec("COMMIT;");
      return asModelUsage(inserted);
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  getModelUsageForRun(runId: string, ownerId = LOCAL_OWNER_ID): StoredModelUsage[] {
    if (!this.getRun(runId, ownerId)) return [];
    return this.#sqlite
      .prepare(
        `SELECT usage_id, run_id, project_id, attempt, status, registry_version, provider_id,
          model_requested, model_resolved, estimated_input_tokens, max_output_tokens,
          estimated_cost_amount, actual_input_tokens, actual_output_tokens,
          calculated_cost_amount, currency, error_code, created_at, updated_at
         FROM model_usage_ledger WHERE run_id = ? ORDER BY attempt ASC`
      )
      .all(runId) as unknown as StoredModelUsage[];
  }

  failModelUsage(runId: string, attempt: number, errorCode: string): void {
    this.#sqlite
      .prepare(
        `UPDATE model_usage_ledger SET status = 'failed', error_code = ?, updated_at = ?
         WHERE run_id = ? AND attempt = ? AND status = 'reserved'`
      )
      .run(errorCode, now(), runId, attempt);
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
        `SELECT id, project_id, chat_id, role, content_type, content, attachments_json, status,
          reply_to_message_id, run_id, error_code, created_at, updated_at
         FROM messages
         WHERE project_id = ?
           AND rowid <= (
             SELECT rowid FROM messages WHERE run_id = ? AND role = 'user' LIMIT 1
           )
         ORDER BY rowid ASC`
      )
      .all(run.project_id, runId)
      .map(asMessage);
  }

  getAssistantMessage(runId: string, ownerId = LOCAL_OWNER_ID): StoredMessage | null {
    if (!this.getRun(runId, ownerId)) return null;
    const row = this.#get(
      this.#sqlite.prepare(
        `SELECT id, project_id, chat_id, role, content_type, content, attachments_json, status,
          reply_to_message_id, run_id, error_code, created_at, updated_at
         FROM messages WHERE run_id = ? AND role = 'assistant'`
      ),
      runId
    );
    return row ? asMessage(row) : null;
  }

  startAssistantMessage(runId: string, ownerId = LOCAL_OWNER_ID): StoredMessage | null {
    const run = this.getRun(runId, ownerId);
    if (!run) return null;
    const existing = this.getAssistantMessage(runId, ownerId);
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
          `SELECT id, project_id, chat_id, role, content_type, content, attachments_json, status,
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
    usage?: { inputTokens: number | null; outputTokens: number | null },
    accounting?: {
      attempt: number;
      calculatedCost: { amount: number; currency: Currency } | null;
    }
  ): void {
    const timestamp = now();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'succeeded', provider = ?, model_resolved = ?,
            input_tokens = ?, output_tokens = ?, updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(
          provider,
          model,
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
          timestamp,
          runId
        );
      if (Number(result.changes) === 0) {
        this.#sqlite.exec("COMMIT;");
        return;
      }
      if (accounting) {
        const ledgerResult = this.#sqlite
          .prepare(
            `UPDATE model_usage_ledger SET status = 'committed', model_resolved = ?,
              actual_input_tokens = ?, actual_output_tokens = ?, calculated_cost_amount = ?,
              currency = COALESCE(?, currency), updated_at = ?
             WHERE run_id = ? AND attempt = ? AND status = 'reserved'`
          )
          .run(
            model,
            usage?.inputTokens ?? null,
            usage?.outputTokens ?? null,
            accounting.calculatedCost?.amount ?? null,
            accounting.calculatedCost?.currency ?? null,
            timestamp,
            runId,
            accounting.attempt
          );
        if (Number(ledgerResult.changes) !== 1) {
          throw new Error(`Missing reserved model usage attempt ${runId}:${accounting.attempt}`);
        }
      }
      this.#sqlite
        .prepare(
          `UPDATE messages SET status = 'completed', updated_at = ?
           WHERE run_id = ? AND role = 'assistant' AND status IN ('pending', 'streaming')`
        )
        .run(timestamp, runId);
      this.#sqlite
        .prepare(
          "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM runs WHERE id = ?)"
        )
        .run(timestamp, runId);
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  failRun(runId: string, errorCode: string): void {
    const timestamp = now();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const runResult = this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'failed', updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(timestamp, runId);
      if (Number(runResult.changes) === 0) {
        this.#sqlite.exec("COMMIT;");
        return;
      }
      this.#sqlite
        .prepare(
          `UPDATE messages SET status = 'failed', error_code = ?, updated_at = ?
           WHERE run_id = ? AND role = 'assistant' AND status IN ('pending', 'streaming')`
        )
        .run(errorCode, timestamp, runId);
      this.#sqlite
        .prepare(
          `UPDATE model_usage_ledger SET status = 'failed', error_code = ?, updated_at = ?
           WHERE run_id = ? AND (
             status = 'reserved' OR
             (? = 'EMERGENCY_STOP' AND status = 'failed' AND error_code = 'INTERRUPTED')
           )`
        )
        .run(errorCode, timestamp, runId, errorCode);
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

    const timestamp = now();
    const assistant = this.getAssistantMessage(runId, ownerId);
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      if (assistant) {
        this.#sqlite
          .prepare(
            `UPDATE messages SET status = 'cancelled', error_code = 'CANCELLED_BY_OWNER', updated_at = ?
             WHERE id = ? AND status IN ('pending', 'streaming')`
          )
          .run(timestamp, assistant.id);
      } else {
        this.#sqlite
          .prepare(
            `INSERT INTO messages
              (id, project_id, chat_id, role, content_type, content, status, run_id, error_code,
               created_at, updated_at)
             VALUES (?, ?, ?, 'assistant', 'text', '', 'cancelled', ?, 'CANCELLED_BY_OWNER', ?, ?)`
          )
          .run(randomUUID(), run.project_id, run.chat_id, runId, timestamp, timestamp);
      }
      this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`
        )
        .run(timestamp, runId);
      this.#sqlite
        .prepare(
          `UPDATE model_usage_ledger SET status = 'cancelled', error_code = 'CANCELLED_BY_OWNER',
            updated_at = ? WHERE run_id = ? AND status = 'reserved'`
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
    const hasLifecycle = Boolean(
      this.#sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kosmora_owner_data_lifecycle'")
        .get()
    );
    const activeProjectFilter = hasLifecycle
      ? " AND project_id IN (SELECT p.id FROM projects p WHERE NOT EXISTS (SELECT 1 FROM kosmora_owner_data_lifecycle f WHERE f.owner_id = p.owner_id AND f.state IN ('deleting', 'deleted', 'error')))"
      : "";
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE messages SET status = 'failed', error_code = ?, updated_at = ?
           WHERE role = 'assistant' AND status = 'streaming'
             AND run_id IN (SELECT id FROM runs WHERE status = 'running'${activeProjectFilter})`
        )
        .run(errorCode, timestamp);
      this.#sqlite
        .prepare(
          `UPDATE model_usage_ledger SET status = 'failed', error_code = ?, updated_at = ?
           WHERE status = 'reserved'
             AND run_id IN (SELECT id FROM runs WHERE status = 'running'${activeProjectFilter})`
        )
        .run(errorCode, timestamp);
      const result = this.#sqlite
        .prepare(
          `UPDATE runs SET status = 'failed', updated_at = ?
           WHERE status = 'running'${activeProjectFilter}`
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
