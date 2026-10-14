import { Type, type Static } from "typebox";

const identity = Type.String({
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
});
export const CreateChatBranchSchema = Type.Union([
  Type.Object(
    {
      client_branch_id: identity,
      message_id: Type.String({ minLength: 1, maxLength: 128 }),
      kind: Type.Literal("edit"),
      content: Type.String({ minLength: 1, maxLength: 100_000, pattern: "\\S" })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      client_branch_id: identity,
      message_id: Type.String({ minLength: 1, maxLength: 128 }),
      kind: Type.Literal("regenerate")
    },
    { additionalProperties: false }
  )
]);
export type CreateChatBranch = Static<typeof CreateChatBranchSchema>;
export const ChatBranchListSchema = Type.Object(
  {
    root_chat_id: Type.String(),
    items: Type.Array(
      Type.Object(
        {
          chat_id: Type.String(),
          title: Type.String(),
          kind: Type.Union([
            Type.Literal("original"),
            Type.Literal("edit"),
            Type.Literal("regenerate")
          ]),
          created_at: Type.String()
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
);
export type ChatBranchList = Static<typeof ChatBranchListSchema>;
