import { Type, type Static } from "typebox";
import { EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";
import { ChatAttachmentsSchema } from "./domain.js";

// === Block 1: Branching & Versions ===
export const ForkAndEditMessageRequestSchema = Type.Object(
  {
    parent_message_id: Type.Union([EntityIdSchema, Type.Null()]),
    content: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" }),
    client_message_id: EntityIdSchema,
    attachments: Type.Optional(ChatAttachmentsSchema)
  },
  { additionalProperties: false }
);
export type ForkAndEditMessageRequest = Static<typeof ForkAndEditMessageRequestSchema>;

export const RegenerateMessageRequestSchema = Type.Object(
  {
    client_message_id: EntityIdSchema
  },
  { additionalProperties: false }
);
export type RegenerateMessageRequest = Static<typeof RegenerateMessageRequestSchema>;

export const SwitchBranchRequestSchema = Type.Object(
  {
    branch_id: Type.String({ minLength: 1, maxLength: 80 })
  },
  { additionalProperties: false }
);
export type SwitchBranchRequest = Static<typeof SwitchBranchRequestSchema>;

// === Block 2: Organization (Folders & Pinning) ===
export const ChatFolderSchema = Type.Object(
  {
    id: EntityIdSchema,
    owner_id: Type.String(),
    name: Type.String({ minLength: 1, maxLength: 80 }),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ChatFolder = Static<typeof ChatFolderSchema>;

export const CreateChatFolderRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" })
  },
  { additionalProperties: false }
);
export type CreateChatFolderRequest = Static<typeof CreateChatFolderRequestSchema>;

export const UpdateChatFolderRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" })
  },
  { additionalProperties: false }
);
export type UpdateChatFolderRequest = Static<typeof UpdateChatFolderRequestSchema>;

export const ChatFolderListResponseSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: EntityIdSchema,
          name: Type.String(),
          chat_count: Type.Integer({ minimum: 0 }),
          created_at: IsoDateTimeSchema,
          updated_at: IsoDateTimeSchema
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export type ChatFolderListResponse = Static<typeof ChatFolderListResponseSchema>;

export const OrganizeChatRequestSchema = Type.Object(
  {
    folder_id: Type.Optional(Type.Union([EntityIdSchema, Type.Null()])),
    pinned: Type.Optional(Type.Boolean()),
    pinned_order: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
    active_branch_id: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  },
  { additionalProperties: false }
);
export type OrganizeChatRequest = Static<typeof OrganizeChatRequestSchema>;

export const ChatSearchMatchSchema = Type.Object(
  {
    chat_id: EntityIdSchema,
    message_id: Type.String(),
    title: Type.String(),
    snippet: Type.String(),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ChatSearchMatch = Static<typeof ChatSearchMatchSchema>;

export const ChatSearchResponseSchema = Type.Object(
  {
    matches: Type.Array(ChatSearchMatchSchema)
  },
  { additionalProperties: false }
);
export type ChatSearchResponse = Static<typeof ChatSearchResponseSchema>;

// === Block 3: Context & Memory ===
export const ToggleMessageContextRequestSchema = Type.Object(
  {
    excluded: Type.Boolean()
  },
  { additionalProperties: false }
);
export type ToggleMessageContextRequest = Static<typeof ToggleMessageContextRequestSchema>;

export const ChatMemorySchema = Type.Object(
  {
    id: EntityIdSchema,
    chat_id: EntityIdSchema,
    branch_id: Type.String(),
    memory_notes: Type.String(),
    summary: Type.String(),
    summary_up_to_message_id: Type.Union([EntityIdSchema, Type.Null()]),
    summary_invalidated: Type.Boolean(),
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ChatMemory = Static<typeof ChatMemorySchema>;

export const UpdateChatMemoryRequestSchema = Type.Object(
  {
    memory_notes: Type.Optional(Type.String({ maxLength: 10_000 })),
    summary: Type.Optional(Type.String({ maxLength: 10_000 })),
    summary_up_to_message_id: Type.Optional(Type.Union([EntityIdSchema, Type.Null()]))
  },
  { additionalProperties: false }
);
export type UpdateChatMemoryRequest = Static<typeof UpdateChatMemoryRequestSchema>;

export const GenerateSummaryRequestSchema = Type.Object(
  {
    branch_id: Type.Optional(Type.String()),
    up_to_message_id: Type.Optional(EntityIdSchema)
  },
  { additionalProperties: false }
);
export type GenerateSummaryRequest = Static<typeof GenerateSummaryRequestSchema>;

// === Block 4: Artifacts (Canvas / Work) ===
export const ChatArtifactKindSchema = Type.Union([
  Type.Literal("document"),
  Type.Literal("code"),
  Type.Literal("table")
]);
export type ChatArtifactKind = Static<typeof ChatArtifactKindSchema>;

export const ChatArtifactSchema = Type.Object(
  {
    id: EntityIdSchema,
    chat_id: EntityIdSchema,
    message_id: EntityIdSchema,
    branch_id: Type.String(),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    kind: ChatArtifactKindSchema,
    language: Type.Union([Type.String(), Type.Null()]),
    content: Type.String(),
    version: Type.Integer({ minimum: 1 }),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ChatArtifact = Static<typeof ChatArtifactSchema>;

export const ChatArtifactVersionSchema = Type.Object(
  {
    id: EntityIdSchema,
    artifact_id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 }),
    title: Type.String(),
    content: Type.String(),
    created_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ChatArtifactVersion = Static<typeof ChatArtifactVersionSchema>;

export const CreateChatArtifactRequestSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    kind: ChatArtifactKindSchema,
    content: Type.String({ minLength: 1, maxLength: 500_000 }),
    language: Type.Optional(Type.String({ maxLength: 40 }))
  },
  { additionalProperties: false }
);
export type CreateChatArtifactRequest = Static<typeof CreateChatArtifactRequestSchema>;

export const UpdateChatArtifactRequestSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" })),
    content: Type.String({ minLength: 1, maxLength: 500_000 })
  },
  { additionalProperties: false }
);
export type UpdateChatArtifactRequest = Static<typeof UpdateChatArtifactRequestSchema>;

export const ChatArtifactListResponseSchema = Type.Object(
  {
    items: Type.Array(ChatArtifactSchema)
  },
  { additionalProperties: false }
);
export type ChatArtifactListResponse = Static<typeof ChatArtifactListResponseSchema>;
