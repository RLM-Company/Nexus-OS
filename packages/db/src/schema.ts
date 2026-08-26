import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const systemMetadata = sqliteTable("cosmora_system_metadata", {
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
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
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

export const autonomyProfiles = sqliteTable("autonomy_profiles", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  profileId: text("profile_id").notNull().unique(),
  baseLevel: text("base_level").notNull(),
  version: integer("version").notNull(),
  profileJson: text("profile_json").notNull(),
  issuedAt: text("issued_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const permissionContracts = sqliteTable(
  "permission_contracts",
  {
    permissionId: text("permission_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").notNull(),
    confirmationId: text("confirmation_id"),
    state: text("state").notNull(),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until"),
    operationsLimit: integer("operations_limit"),
    operationsUsed: integer("operations_used").notNull().default(0),
    contractJson: text("contract_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("permission_contracts_lookup_idx").on(
      table.projectId,
      table.subjectId,
      table.state,
      table.validUntil
    )
  ]
);

export const confirmationRequests = sqliteTable(
  "confirmation_requests",
  {
    confirmationId: text("confirmation_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull().unique(),
    actorId: text("actor_id").notNull(),
    status: text("status").notNull(),
    intentJson: text("intent_json").notNull(),
    verdictJson: text("verdict_json").notNull(),
    challengeNonce: text("challenge_nonce").notNull(),
    requiresStepUp: integer("requires_step_up", { mode: "boolean" }).notNull(),
    requestedAt: text("requested_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    decidedAt: text("decided_at"),
    decidedBy: text("decided_by"),
    decisionReason: text("decision_reason")
  },
  (table) => [index("confirmation_requests_project_status_idx").on(table.projectId, table.status)]
);

export const policyOperations = sqliteTable(
  "policy_operations",
  {
    operationId: text("operation_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    intentJson: text("intent_json").notNull(),
    verdictJson: text("verdict_json").notNull(),
    confirmationId: text("confirmation_id").references(() => confirmationRequests.confirmationId, {
      onDelete: "set null"
    }),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("policy_operations_project_idempotency_unique").on(
      table.projectId,
      table.idempotencyKey
    )
  ]
);

export const policyDecisions = sqliteTable(
  "policy_decisions",
  {
    decisionId: text("decision_id").primaryKey(),
    operationId: text("operation_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    verdict: text("verdict").notNull(),
    intentJson: text("intent_json").notNull(),
    verdictJson: text("verdict_json").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [index("policy_decisions_operation_idx").on(table.operationId, table.createdAt)]
);
