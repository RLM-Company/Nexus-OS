import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

export const OnboardingStatusSchema = Type.Union([
  Type.Literal("not_started"),
  Type.Literal("in_progress"),
  Type.Literal("completed")
]);
export type OnboardingStatus = Static<typeof OnboardingStatusSchema>;

export const ProjectStatusSchema = Type.Union([
  Type.Literal("DRAFT"),
  Type.Literal("ACTIVE"),
  Type.Literal("FAILED"),
  Type.Literal("ARCHIVED")
]);
export type ProjectStatus = Static<typeof ProjectStatusSchema>;

export const MessageRoleSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
  Type.Literal("system_event")
]);
export type MessageRole = Static<typeof MessageRoleSchema>;

export const MessageStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("streaming"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type MessageStatus = Static<typeof MessageStatusSchema>;

export const RunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);
export type RunStatus = Static<typeof RunStatusSchema>;

export const ProjectSummarySchema = Type.Object(
  {
    id: EntityIdSchema,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    status: ProjectStatusSchema,
    updated_at: IsoDateTimeSchema,
    last_message_preview: Type.Union([Type.String({ maxLength: 240 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type ProjectSummary = Static<typeof ProjectSummarySchema>;

export const MessageSchema = Type.Object(
  {
    id: EntityIdSchema,
    project_id: EntityIdSchema,
    chat_id: EntityIdSchema,
    role: MessageRoleSchema,
    content_type: Type.Literal("text"),
    content: Type.String(),
    status: MessageStatusSchema,
    reply_to_message_id: Type.Union([EntityIdSchema, Type.Null()]),
    run_id: Type.Union([EntityIdSchema, Type.Null()]),
    error_code: Type.Union([Type.String(), Type.Null()]),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type Message = Static<typeof MessageSchema>;

export const CreateProjectRequestSchema = Type.Object(
  {
    initial_message: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" }),
    client_message_id: EntityIdSchema
  },
  { additionalProperties: false }
);
export type CreateProjectRequest = Static<typeof CreateProjectRequestSchema>;

export const CreateMessageRequestSchema = Type.Object(
  {
    content: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" }),
    client_message_id: EntityIdSchema
  },
  { additionalProperties: false }
);
export type CreateMessageRequest = Static<typeof CreateMessageRequestSchema>;

export const ProjectSchema = Type.Object(
  {
    id: EntityIdSchema,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    status: ProjectStatusSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type Project = Static<typeof ProjectSchema>;

export const ProjectListResponseSchema = Type.Object(
  { items: Type.Array(ProjectSummarySchema) },
  { additionalProperties: false }
);
export type ProjectListResponse = Static<typeof ProjectListResponseSchema>;

export const ProjectDetailResponseSchema = Type.Object(
  {
    project: ProjectSchema,
    chat_id: EntityIdSchema,
    messages: Type.Array(MessageSchema)
  },
  { additionalProperties: false }
);
export type ProjectDetailResponse = Static<typeof ProjectDetailResponseSchema>;

export const MessageAcceptedResponseSchema = Type.Object(
  {
    project: ProjectSchema,
    chat_id: EntityIdSchema,
    user_message: MessageSchema,
    run_id: EntityIdSchema,
    stream_url: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type MessageAcceptedResponse = Static<typeof MessageAcceptedResponseSchema>;

export const RunCancelResponseSchema = Type.Object(
  {
    run_id: EntityIdSchema,
    status: Type.Literal("cancelled")
  },
  { additionalProperties: false }
);
export type RunCancelResponse = Static<typeof RunCancelResponseSchema>;

export const GeneralChatSchema = Type.Object(
  {
    id: EntityIdSchema,
    title: Type.String({ minLength: 1, maxLength: 160 }),
    assistant_profile_name: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type GeneralChat = Static<typeof GeneralChatSchema>;

export const AssistantProfileSnapshotSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    instructions: Type.String({ minLength: 1, maxLength: 4_000 })
  },
  { additionalProperties: false }
);
export type AssistantProfileSnapshot = Static<typeof AssistantProfileSnapshotSchema>;

export const AssistantProfileSchema = Type.Object(
  {
    id: EntityIdSchema,
    ...AssistantProfileSnapshotSchema.properties,
    avatar: Type.Union([Type.String({ minLength: 1, maxLength: 16, pattern: "\\S" }), Type.Null()]),
    starter_prompts: Type.Array(Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }), {
      maxItems: 4
    }),
    version: Type.Integer({ minimum: 1 }),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type AssistantProfile = Static<typeof AssistantProfileSchema>;

export const AssistantProfileListResponseSchema = Type.Object(
  { items: Type.Array(AssistantProfileSchema, { maxItems: 50 }) },
  { additionalProperties: false }
);
export type AssistantProfileListResponse = Static<typeof AssistantProfileListResponseSchema>;

export const CreateAssistantProfileRequestSchema = Type.Object(
  {
    profile_id: EntityIdSchema,
    ...AssistantProfileSnapshotSchema.properties,
    avatar: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 16, pattern: "\\S" }), Type.Null()])
    ),
    starter_prompts: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }), { maxItems: 4 })
    )
  },
  { additionalProperties: false }
);
export type CreateAssistantProfileRequest = Static<typeof CreateAssistantProfileRequestSchema>;

export const UpdateAssistantProfileRequestSchema = Type.Object(
  {
    ...AssistantProfileSnapshotSchema.properties,
    avatar: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 16, pattern: "\\S" }), Type.Null()])
    ),
    starter_prompts: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }), { maxItems: 4 })
    ),
    expected_version: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
export type UpdateAssistantProfileRequest = Static<typeof UpdateAssistantProfileRequestSchema>;

export const DeleteAssistantProfileRequestSchema = Type.Object(
  { expected_version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
);
export type DeleteAssistantProfileRequest = Static<typeof DeleteAssistantProfileRequestSchema>;

export const DeleteAssistantProfileResponseSchema = Type.Object(
  { profile_id: EntityIdSchema, deleted: Type.Literal(true) },
  { additionalProperties: false }
);
export type DeleteAssistantProfileResponse = Static<typeof DeleteAssistantProfileResponseSchema>;

export const GeneralChatSummarySchema = Type.Object(
  {
    ...GeneralChatSchema.properties,
    last_message_preview: Type.Union([Type.String({ maxLength: 240 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type GeneralChatSummary = Static<typeof GeneralChatSummarySchema>;

export const GeneralChatMessageSchema = Type.Object(
  {
    id: EntityIdSchema,
    chat_id: EntityIdSchema,
    role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
    content_type: Type.Literal("text"),
    content: Type.String(),
    status: MessageStatusSchema,
    run_id: Type.Union([EntityIdSchema, Type.Null()]),
    error_code: Type.Union([Type.String(), Type.Null()]),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type GeneralChatMessage = Static<typeof GeneralChatMessageSchema>;

export const CreateGeneralChatRequestSchema = Type.Object(
  {
    initial_message: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" }),
    client_message_id: EntityIdSchema,
    assistant_profile: Type.Optional(AssistantProfileSnapshotSchema)
  },
  { additionalProperties: false }
);
export type CreateGeneralChatRequest = Static<typeof CreateGeneralChatRequestSchema>;

export const GeneralChatListResponseSchema = Type.Object(
  { items: Type.Array(GeneralChatSummarySchema) },
  { additionalProperties: false }
);
export type GeneralChatListResponse = Static<typeof GeneralChatListResponseSchema>;

export const GeneralChatDetailResponseSchema = Type.Object(
  {
    chat: GeneralChatSchema,
    messages: Type.Array(GeneralChatMessageSchema)
  },
  { additionalProperties: false }
);
export type GeneralChatDetailResponse = Static<typeof GeneralChatDetailResponseSchema>;

export const GeneralChatMessageAcceptedResponseSchema = Type.Object(
  {
    chat: GeneralChatSchema,
    user_message: GeneralChatMessageSchema,
    run_id: EntityIdSchema,
    stream_url: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
export type GeneralChatMessageAcceptedResponse = Static<
  typeof GeneralChatMessageAcceptedResponseSchema
>;
