import { Type, type Static } from "typebox";

export const CHAT_SKILLS_MAX_COUNT = 3;
export const CHAT_SKILLS_MAX_BYTES = 16_000;
export const ChatSkillReferenceSchema = Type.Object(
  {
    skill_id: Type.String({ minLength: 1, maxLength: 160 }),
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  },
  { additionalProperties: false }
);
export type ChatSkillReference = Static<typeof ChatSkillReferenceSchema>;
/** Where a rule came from. Optional for older run snapshots; the active stores
 * always fill it. Precedence is fixed: task > chat > project > owner. */
export type ChatSkillScope = "owner" | "project" | "chat" | "task";
export const CHAT_SKILL_PRECEDENCE: readonly ChatSkillScope[] = [
  "task",
  "chat",
  "project",
  "owner"
];
export type ChatSkillSnapshot = ChatSkillReference & {
  name: string;
  summary: string;
  instructions: string;
  scope?: ChatSkillScope;
};
export type ChatSkillSelection = {
  version: number;
  updated_at: string | null;
  items: ChatSkillSnapshot[];
};
export const UpdateChatSkillsSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
    items: Type.Array(ChatSkillReferenceSchema, { maxItems: CHAT_SKILLS_MAX_COUNT })
  },
  { additionalProperties: false }
);
