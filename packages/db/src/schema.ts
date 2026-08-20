import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const systemMetadata = sqliteTable("nexus_system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt)]
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [uniqueIndex("chats_project_kind_unique").on(table.projectId, table.kind)]
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    provider: text("provider"),
    modelResolved: text("model_resolved"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("runs_project_created_idx").on(table.projectId, table.createdAt)]
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    contentType: text("content_type").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull(),
    clientMessageId: text("client_message_id"),
    replyToMessageId: text("reply_to_message_id"),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("messages_chat_created_idx").on(table.chatId, table.createdAt),
    uniqueIndex("messages_client_id_unique").on(table.clientMessageId)
  ]
);
