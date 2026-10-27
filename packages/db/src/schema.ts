import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const systemMetadata = sqliteTable("cosmora_system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const payOrders = sqliteTable(
  "pay_orders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    customerRef: text("customer_ref").notNull(),
    planCode: text("plan_code").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    providerPaymentId: text("provider_payment_id"),
    confirmationUrl: text("confirmation_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("pay_orders_owner_idempotency_unique").on(table.ownerId, table.idempotencyKey),
    uniqueIndex("pay_orders_provider_unique").on(table.providerPaymentId),
    index("pay_orders_owner_created").on(table.ownerId, table.createdAt)
  ]
);

export const payOrderEvents = sqliteTable(
  "pay_order_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => payOrders.id),
    ownerId: text("owner_id").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [index("pay_events_order_created").on(table.orderId, table.createdAt)]
);

export const identityActors = sqliteTable(
  "identity_actors",
  {
    actorId: text("actor_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("identity_actors_owner_status_idx").on(table.ownerId, table.status)]
);

export const identitySessions = sqliteTable(
  "identity_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => identityActors.actorId, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    assurance: text("assurance").notNull(),
    status: text("status").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by"),
    revokeReason: text("revoke_reason")
  },
  (table) => [
    uniqueIndex("identity_sessions_token_hash_unique").on(table.tokenHash),
    index("identity_sessions_owner_status_expires_idx").on(
      table.ownerId,
      table.status,
      table.expiresAt
    ),
    index("identity_sessions_actor_status_idx").on(table.actorId, table.status)
  ]
);

export const identityAuditEvents = sqliteTable(
  "identity_audit_events",
  {
    eventId: text("event_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    actorId: text("actor_id").notNull(),
    sessionId: text("session_id").references(() => identitySessions.sessionId, {
      onDelete: "set null"
    }),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    reasonCode: text("reason_code"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("identity_audit_owner_created_idx").on(table.ownerId, table.createdAt),
    index("identity_audit_session_created_idx").on(table.sessionId, table.createdAt)
  ]
);

export const stepUpProofs = sqliteTable(
  "step_up_proofs",
  {
    proofId: text("proof_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    actorId: text("actor_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => identitySessions.sessionId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull(),
    challengeHash: text("challenge_hash").notNull(),
    status: text("status").notNull(),
    issuedAt: text("issued_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at")
  },
  (table) => [
    uniqueIndex("step_up_proofs_token_hash_unique").on(table.tokenHash),
    index("step_up_proofs_owner_status_expires_idx").on(
      table.ownerId,
      table.status,
      table.expiresAt
    ),
    index("step_up_proofs_session_status_idx").on(table.sessionId, table.status)
  ]
);

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
  (table) => [
    index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt),
    uniqueIndex("projects_id_owner_unique").on(table.id, table.ownerId)
  ]
);

export const agentFunctionDefinitions = sqliteTable(
  "agent_function_definitions",
  {
    functionId: text("function_id").notNull(),
    version: integer("version").notNull(),
    scope: text("scope").notNull(),
    ownerId: text("owner_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    resultContract: text("result_contract").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.functionId, table.version] }),
    index("agent_functions_visibility_idx").on(
      table.scope,
      table.ownerId,
      table.projectId,
      table.functionId,
      table.version
    ),
    check(
      "agent_functions_scope_binding_check",
      sql`(${table.scope} = 'product' AND ${table.ownerId} IS NULL AND ${table.projectId} IS NULL)
          OR (${table.scope} = 'owner' AND ${table.ownerId} IS NOT NULL AND ${table.projectId} IS NULL)
          OR (${table.scope} = 'project' AND ${table.ownerId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`
    )
  ]
);

export const behaviorPatterns = sqliteTable(
  "behavior_patterns",
  {
    patternId: text("pattern_id").notNull(),
    version: integer("version").notNull(),
    scope: text("scope").notNull(),
    ownerId: text("owner_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    instructions: text("instructions").notNull(),
    allowedFunctionIdsJson: text("allowed_function_ids_json").notNull(),
    knownLimitationsJson: text("known_limitations_json").notNull(),
    testStatus: text("test_status").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: text("created_at").notNull(),
    archivedAt: text("archived_at")
  },
  (table) => [
    primaryKey({ columns: [table.patternId, table.version] }),
    index("behavior_patterns_visibility_idx").on(
      table.scope,
      table.ownerId,
      table.projectId,
      table.patternId,
      table.version
    ),
    check(
      "behavior_patterns_scope_binding_check",
      sql`(${table.scope} = 'product' AND ${table.ownerId} IS NULL AND ${table.projectId} IS NULL)
          OR (${table.scope} = 'owner' AND ${table.ownerId} IS NOT NULL AND ${table.projectId} IS NULL)
          OR (${table.scope} = 'project' AND ${table.ownerId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`
    )
  ]
);

export const agentBlueprints = sqliteTable(
  "agent_blueprints",
  {
    blueprintId: text("blueprint_id").notNull(),
    version: integer("version").notNull(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id").notNull(),
    functionId: text("function_id").notNull(),
    functionVersion: integer("function_version").notNull(),
    patternId: text("pattern_id").notNull(),
    patternVersion: integer("pattern_version").notNull(),
    modelProfileId: text("model_profile_id").notNull(),
    modelProfileVersion: integer("model_profile_version").notNull(),
    grantJson: text("grant_json").notNull(),
    memoryScopeJson: text("memory_scope_json").notNull(),
    taskContract: text("task_contract").notNull(),
    startCondition: text("start_condition").notNull(),
    closeConditionsJson: text("close_conditions_json").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.blueprintId, table.version] }),
    uniqueIndex("agent_blueprints_binding_unique").on(
      table.blueprintId,
      table.version,
      table.ownerId,
      table.projectId
    ),
    foreignKey({
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId]
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.functionId, table.functionVersion],
      foreignColumns: [agentFunctionDefinitions.functionId, agentFunctionDefinitions.version]
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.patternId, table.patternVersion],
      foreignColumns: [behaviorPatterns.patternId, behaviorPatterns.version]
    }).onDelete("restrict"),
    index("agent_blueprints_owner_project_idx").on(
      table.ownerId,
      table.projectId,
      table.blueprintId,
      table.version
    )
  ]
);

export const agentStudioMutations = sqliteTable(
  "agent_studio_mutations",
  {
    mutationId: text("mutation_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id").notNull(),
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    operationType: text("operation_type").notNull(),
    requestHash: text("request_hash").notNull(),
    resultId: text("result_id").notNull(),
    resultVersion: integer("result_version").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("agent_studio_mutations_owner_project_key_unique").on(
      table.ownerId,
      table.projectId,
      table.idempotencyKey
    ),
    index("agent_studio_mutations_owner_project_created_idx").on(
      table.ownerId,
      table.projectId,
      table.createdAt
    ),
    foreignKey({
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
      name: "agent_studio_mutations_project_owner_fk"
    }).onDelete("cascade"),
    check("agent_studio_mutations_result_version_check", sql`${table.resultVersion} >= 1`)
  ]
);

export const agentStudioDecisionEvents = sqliteTable(
  "agent_studio_decision_events",
  {
    eventId: text("event_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id").notNull(),
    actorId: text("actor_id").notNull(),
    operationType: text("operation_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    objectVersion: integer("object_version").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    index("agent_studio_decision_events_owner_project_created_idx").on(
      table.ownerId,
      table.projectId,
      table.createdAt
    ),
    foreignKey({
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
      name: "agent_studio_decision_events_project_owner_fk"
    }).onDelete("cascade"),
    check("agent_studio_decision_events_object_version_check", sql`${table.objectVersion} >= 1`)
  ]
);

export const agentInstances = sqliteTable(
  "agent_instances",
  {
    instanceId: text("instance_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    projectId: text("project_id").notNull(),
    blueprintId: text("blueprint_id").notNull(),
    blueprintVersion: integer("blueprint_version").notNull(),
    parentInstanceId: text("parent_instance_id"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    closedAt: text("closed_at")
  },
  (table) => [
    uniqueIndex("agent_instances_binding_unique").on(
      table.instanceId,
      table.ownerId,
      table.projectId
    ),
    foreignKey({
      columns: [table.blueprintId, table.blueprintVersion, table.ownerId, table.projectId],
      foreignColumns: [
        agentBlueprints.blueprintId,
        agentBlueprints.version,
        agentBlueprints.ownerId,
        agentBlueprints.projectId
      ]
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.parentInstanceId, table.ownerId, table.projectId],
      foreignColumns: [table.instanceId, table.ownerId, table.projectId]
    }).onDelete("restrict"),
    index("agent_instances_owner_project_status_idx").on(
      table.ownerId,
      table.projectId,
      table.status,
      table.createdAt
    ),
    check(
      "agent_instances_proposed_only_check",
      sql`${table.status} = 'proposed' AND ${table.closedAt} IS NULL`
    )
  ]
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

export const generalChats = sqliteTable(
  "general_chats",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("general_chats_id_owner_unique").on(table.id, table.ownerId),
    index("general_chats_owner_updated_idx").on(table.ownerId, table.updatedAt)
  ]
);

export const generalChatRuns = sqliteTable(
  "general_chat_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => generalChats.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    provider: text("provider"),
    modelResolved: text("model_resolved"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [index("general_chat_runs_chat_created_idx").on(table.chatId, table.createdAt)]
);

export const generalChatMessages = sqliteTable(
  "general_chat_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => generalChats.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    role: text("role").notNull(),
    contentType: text("content_type").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull(),
    clientMessageId: text("client_message_id"),
    runId: text("run_id").references(() => generalChatRuns.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("general_chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
    uniqueIndex("general_chat_messages_owner_client_unique").on(
      table.ownerId,
      table.clientMessageId
    )
  ]
);

export const generalChatModelUsage = sqliteTable(
  "general_chat_model_usage",
  {
    usageId: text("usage_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => generalChatRuns.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => generalChats.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    registryVersion: text("registry_version").notNull(),
    providerId: text("provider_id").notNull(),
    modelRequested: text("model_requested").notNull(),
    modelResolved: text("model_resolved"),
    estimatedInputTokens: integer("estimated_input_tokens").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    estimatedCostAmount: real("estimated_cost_amount"),
    actualInputTokens: integer("actual_input_tokens"),
    actualOutputTokens: integer("actual_output_tokens"),
    calculatedCostAmount: real("calculated_cost_amount"),
    currency: text("currency"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("general_chat_model_usage_run_attempt_unique").on(table.runId, table.attempt),
    index("general_chat_model_usage_chat_created_idx").on(table.chatId, table.createdAt)
  ]
);

export const modelUsageLedger = sqliteTable(
  "model_usage_ledger",
  {
    usageId: text("usage_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    registryVersion: text("registry_version").notNull(),
    providerId: text("provider_id").notNull(),
    modelRequested: text("model_requested").notNull(),
    modelResolved: text("model_resolved"),
    estimatedInputTokens: integer("estimated_input_tokens").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    estimatedCostAmount: real("estimated_cost_amount"),
    actualInputTokens: integer("actual_input_tokens"),
    actualOutputTokens: integer("actual_output_tokens"),
    calculatedCostAmount: real("calculated_cost_amount"),
    currency: text("currency"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("model_usage_ledger_run_attempt_unique").on(table.runId, table.attempt),
    index("model_usage_ledger_project_created_idx").on(table.projectId, table.createdAt)
  ]
);

export const projectUsageLimits = sqliteTable(
  "project_usage_limits",
  {
    projectId: text("project_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    version: integer("version").notNull(),
    maxTotalTokens: integer("max_total_tokens"),
    maxCostAmount: real("max_cost_amount"),
    currency: text("currency"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId]
    }).onDelete("cascade"),
    check("project_usage_limits_version_check", sql`${table.version} >= 1`),
    check(
      "project_usage_limits_token_check",
      sql`${table.maxTotalTokens} IS NULL OR ${table.maxTotalTokens} >= 1`
    ),
    check(
      "project_usage_limits_cost_check",
      sql`(${table.maxCostAmount} IS NULL AND ${table.currency} IS NULL)
          OR (${table.maxCostAmount} > 0 AND ${table.currency} IN ('USD', 'RUB'))`
    )
  ]
);

export const emergencyStops = sqliteTable(
  "emergency_stops",
  {
    scopeKey: text("scope_key").primaryKey(),
    scope: text("scope").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    active: integer("active", { mode: "boolean" }).notNull(),
    reason: text("reason").notNull(),
    activatedAt: text("activated_at").notNull(),
    activatedBy: text("activated_by").notNull(),
    clearedAt: text("cleared_at"),
    clearedBy: text("cleared_by")
  },
  (table) => [
    index("emergency_stops_scope_active_idx").on(table.scope, table.active),
    uniqueIndex("emergency_stops_project_unique").on(table.projectId)
  ]
);

export const emergencyStopClearanceEvents = sqliteTable(
  "emergency_stop_clearance_events",
  {
    eventId: text("event_id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    scope: text("scope").notNull(),
    projectId: text("project_id"),
    activationReason: text("activation_reason").notNull(),
    activatedAt: text("activated_at").notNull(),
    activatedBy: text("activated_by").notNull(),
    clearanceReason: text("clearance_reason").notNull(),
    clearedAt: text("cleared_at").notNull(),
    clearedBy: text("cleared_by").notNull()
  },
  (table) => [
    uniqueIndex("emergency_stop_clearance_scope_activation_unique").on(
      table.scopeKey,
      table.activatedAt
    ),
    index("emergency_stop_clearance_owner_cleared_idx").on(table.ownerId, table.clearedAt),
    check("emergency_stop_clearance_scope_check", sql`${table.scope} IN ('process', 'project')`),
    check(
      "emergency_stop_clearance_project_check",
      sql`(${table.scope} = 'process' AND ${table.scopeKey} = 'process' AND ${table.projectId} IS NULL)
          OR (${table.scope} = 'project' AND ${table.scopeKey} = 'project:' || ${table.projectId}
              AND ${table.projectId} IS NOT NULL)`
    )
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

export const managerWork = sqliteTable(
  "manager_work",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    version: integer("version").notNull(),
    stateJson: text("state_json").notNull()
  },
  (table) => [
    uniqueIndex("manager_work_request_unique").on(
      table.projectId,
      table.ownerId,
      table.clientRequestId
    )
  ]
);

export const managerWorkFiles = sqliteTable(
  "manager_work_files",
  {
    executionId: text("execution_id")
      .notNull()
      .references(() => managerWork.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull()
  },
  (table) => [primaryKey({ columns: [table.executionId, table.name] })]
);
