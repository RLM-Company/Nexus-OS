import { Type, type Static } from "typebox";
import { IsoDateTimeSchema } from "./primitives.js";

const id = Type.String({ minLength: 1, maxLength: 128 });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
export const MemoryTargetSchema = Type.Object(
  { kind: Type.Union([Type.Literal("chat"), Type.Literal("project")]), id },
  { additionalProperties: false }
);
export type MemoryTarget = Static<typeof MemoryTargetSchema>;
export const MemorySourceInputSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("chat_message"), Type.Literal("project_message")]),
    message_id: id,
    quote: text(2000)
  },
  { additionalProperties: false }
);
export const ContextMemoryInputSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal("personal"), Type.Literal("chat"), Type.Literal("project")]),
    scope_id: Type.Union([id, Type.Null()]),
    kind: Type.Union([
      Type.Literal("fact"),
      Type.Literal("preference"),
      Type.Literal("decision"),
      Type.Literal("constraint"),
      Type.Literal("hypothesis")
    ]),
    title: text(160),
    content: text(2000),
    pinned: Type.Boolean(),
    expires_at: Type.Union([IsoDateTimeSchema, Type.Null()]),
    source: Type.Union([MemorySourceInputSchema, Type.Null()])
  },
  { additionalProperties: false }
);
export type ContextMemoryInput = Static<typeof ContextMemoryInputSchema>;
export const ContextMemoryCreateSchema = Type.Object(
  { ...ContextMemoryInputSchema.properties, client_creation_id: Type.Optional(id) },
  { additionalProperties: false }
);
export const ContextMemoryUpdateSchema = Type.Object(
  {
    ...ContextMemoryInputSchema.properties,
    expected_version: Type.Integer({ minimum: 1, maximum: 1_000_000 })
  },
  { additionalProperties: false }
);
export const ContextMemorySettingsInputSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    use_personal: Type.Boolean(),
    source_chat_ids: Type.Array(id, { maxItems: 32, uniqueItems: true }),
    project_ids: Type.Array(id, { maxItems: 8, uniqueItems: true }),
    expected_version: Type.Integer({ minimum: 0, maximum: 1_000_000 })
  },
  { additionalProperties: false }
);
export type ContextMemorySettingsInput = Static<typeof ContextMemorySettingsInputSchema>;
export interface ContextMemorySettings extends Omit<
  ContextMemorySettingsInput,
  "expected_version"
> {
  version: number;
}
export interface ContextMemorySource {
  kind: "chat_message" | "project_message";
  message_id: string;
  chat_id: string;
  project_id: string | null;
  role: "user" | "assistant";
  quote: string;
  sha256: string;
}
export interface ContextMemoryEntry extends Omit<ContextMemoryInput, "source"> {
  id: string;
  version: number;
  source: ContextMemorySource | null;
  source_status: "current" | "changed" | "unavailable" | "manual";
  created_at: string;
  updated_at: string;
}
export interface ContextMemoryEvidence {
  reference: string;
  kind: "memory" | "history";
  text: string;
  title: string;
  source: ContextMemorySource | null;
  memory_kind?: ContextMemoryInput["kind"];
  version?: number;
  excerpt_only: boolean;
  priority?: boolean;
}
export interface ContextMemoryBundle {
  format: "kosmora.context-memory.v1";
  target: MemoryTarget;
  items: ContextMemoryEvidence[];
  omitted: number;
  priority_omitted: number;
  /** UTF-8 size of this entire JSON bundle; conservative bound, NOT actual model tokens. */
  bytes: number;
  budget_bytes: number;
  retrieval: "lexical";
}
