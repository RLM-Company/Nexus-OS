import { Type, type Static } from "typebox";

export const CHAT_MEMORY_MAX_LENGTH = 4_000;
export const ChatMemorySchema = Type.Object(
  {
    memory_notes: Type.String({ maxLength: CHAT_MEMORY_MAX_LENGTH }),
    version: Type.Integer({ minimum: 0 }),
    updated_at: Type.Union([Type.String(), Type.Null()])
  },
  { additionalProperties: false }
);
export type ChatMemory = Static<typeof ChatMemorySchema>;
export const UpdateChatMemorySchema = Type.Object(
  {
    memory_notes: Type.String({ maxLength: CHAT_MEMORY_MAX_LENGTH }),
    expected_version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  },
  { additionalProperties: false }
);
