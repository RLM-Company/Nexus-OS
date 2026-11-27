import { Type, type Static } from "typebox";
import { IsoDateTimeSchema } from "./primitives.js";

const id = Type.String({ minLength: 1, maxLength: 128 });
const scope = Type.Union([
  Type.Literal("chat.read"),
  Type.Literal("chat.write"),
  Type.Literal("tasks.read"),
  Type.Literal("tasks.write"),
  Type.Literal("files.read"),
  Type.Literal("files.write"),
  Type.Literal("webhooks.write")
]);
export type DeveloperScope = Static<typeof scope>;
export const DEVELOPER_SCOPES: readonly DeveloperScope[] = [
  "chat.read",
  "chat.write",
  "tasks.read",
  "tasks.write",
  "files.read",
  "files.write",
  "webhooks.write"
] as const;

/** What the client sees once, at issuance. Only the hash is stored. */
export const DeveloperKeyIssuedSchema = Type.Object(
  {
    key_id: id,
    owner_id: id,
    token: Type.String({ minLength: 16, maxLength: 512 }),
    scopes: Type.Array(scope, { minItems: 1, maxItems: DEVELOPER_SCOPES.length }),
    created_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type DeveloperKeyIssued = Static<typeof DeveloperKeyIssuedSchema>;

export const DeveloperKeyViewSchema = Type.Object(
  {
    key_id: id,
    owner_id: id,
    scopes: Type.Array(scope, { minItems: 1, maxItems: DEVELOPER_SCOPES.length }),
    created_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema,
    revoked_at: Type.Union([IsoDateTimeSchema, Type.Null()]),
    last_used_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type DeveloperKeyView = Static<typeof DeveloperKeyViewSchema>;

/** OpenAI-compatible subset actually implemented by the developer chat endpoint. */
export const DeveloperChatMessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("user"), Type.Literal("system"), Type.Literal("assistant")]),
    content: Type.String({ minLength: 1, maxLength: 100_000 })
  },
  { additionalProperties: false }
);
export const DeveloperChatRequestSchema = Type.Object(
  {
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    messages: Type.Array(DeveloperChatMessageSchema, { minItems: 1, maxItems: 60 }),
    stream: Type.Optional(Type.Boolean()),
    mode: Type.Optional(Type.Union([Type.Literal("standard"), Type.Literal("fast")])),
    client_request_id: Type.Optional(id)
  },
  { additionalProperties: false }
);
export type DeveloperChatRequest = Static<typeof DeveloperChatRequestSchema>;

export const DeveloperErrorSchema = Type.Object(
  {
    error: Type.Object({
      type: Type.String({ minLength: 1, maxLength: 64 }),
      code: Type.String({ minLength: 1, maxLength: 64 }),
      message: Type.String({ minLength: 1, maxLength: 500 }),
      request_id: Type.Optional(id)
    })
  },
  { additionalProperties: false }
);
export type DeveloperError = Static<typeof DeveloperErrorSchema>;

export const DeveloperUsageSchema = Type.Object(
  {
    request_id: id,
    run_id: Type.Optional(id),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    input_tokens: Type.Integer({ minimum: 0 }),
    output_tokens: Type.Integer({ minimum: 0 }),
    first_token_ms: Type.Optional(Type.Integer({ minimum: 0 })),
    total_ms: Type.Optional(Type.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);
export type DeveloperUsage = Static<typeof DeveloperUsageSchema>;

export const DeveloperTaskRequestSchema = Type.Object(
  {
    goal: Type.String({ minLength: 2, maxLength: 4000 }),
    files: Type.Optional(Type.Array(id, { maxItems: 20 })),
    client_request_id: id
  },
  { additionalProperties: false }
);
export type DeveloperTaskRequest = Static<typeof DeveloperTaskRequestSchema>;

export const DeveloperTaskViewSchema = Type.Object(
  {
    task_id: id,
    owner_id: id,
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("cancelled")
    ]),
    goal: Type.String({ maxLength: 4000 }),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
    result_file: Type.Union([id, Type.Null()])
  },
  { additionalProperties: false }
);
export type DeveloperTaskView = Static<typeof DeveloperTaskViewSchema>;

export const DeveloperWebhookSubscriptionSchema = Type.Object(
  {
    webhook_id: id,
    owner_id: id,
    url: Type.String({ minLength: 8, maxLength: 2048 }),
    events: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      minItems: 1,
      maxItems: 20
    }),
    created_at: IsoDateTimeSchema,
    revoked_at: Type.Union([IsoDateTimeSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type DeveloperWebhookSubscription = Static<typeof DeveloperWebhookSubscriptionSchema>;
