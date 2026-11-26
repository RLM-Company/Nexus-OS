import { Type, type Static } from "typebox";

const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const id = Type.String({ minLength: 1, maxLength: 128 });

/** A bounded, immutable link to the exact material that was used in one run. */
export const UsedSourceSchema = Type.Object(
  {
    label: Type.Optional(Type.String({ maxLength: 180 })),
    reference: Type.String({ minLength: 3, maxLength: 200 }),
    kind: Type.Union([
      Type.Literal("memory"),
      Type.Literal("history"),
      Type.Literal("canvas"),
      Type.Literal("work"),
      Type.Literal("document"),
      Type.Literal("research"),
      Type.Literal("input")
    ]),
    source_kind: Type.Union([
      Type.Literal("chat_message"),
      Type.Literal("project_message"),
      Type.Literal("artifact"),
      Type.Literal("document_chunk"),
      Type.Literal("memory_entry"),
      Type.Literal("research_page"),
      Type.Literal("work_input")
    ]),
    source_id: id,
    version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    sha256: hash,
    quote: Type.String({ maxLength: 4000 }),
    excerpt_only: Type.Boolean(),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    line_start: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
    line_end: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 }))
  },
  { additionalProperties: false }
);
export type UsedSource = Static<typeof UsedSourceSchema>;

export const SourceExclusionSchema = Type.Object(
  {
    source_kind: UsedSourceSchema.properties.source_kind,
    source_id: id,
    excluded_at: Type.String({ maxLength: 40 }),
    reason: Type.String({ maxLength: 500 })
  },
  { additionalProperties: false }
);
export type SourceExclusion = Static<typeof SourceExclusionSchema>;

export const SourceExclusionsInputSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    exclusions: Type.Array(SourceExclusionSchema, { maxItems: 500 })
  },
  { additionalProperties: false }
);
export type SourceExclusionsInput = Static<typeof SourceExclusionsInputSchema>;

export const SourceExclusionsViewSchema = Type.Object(
  {
    project_id: id,
    version: Type.Integer({ minimum: 1 }),
    items: Type.Array(SourceExclusionSchema, { maxItems: 500 })
  },
  { additionalProperties: false }
);
export type SourceExclusionsView = Static<typeof SourceExclusionsViewSchema>;

export const RunSourcesInputSchema = Type.Object(
  {
    run_id: id,
    sources: Type.Array(UsedSourceSchema, { maxItems: 128 })
  },
  { additionalProperties: false }
);
export type RunSourcesInput = Static<typeof RunSourcesInputSchema>;

export const RunSourcesViewSchema = Type.Object(
  {
    project_id: id,
    run_id: id,
    at: Type.String({ maxLength: 40 }),
    sources: Type.Array(UsedSourceSchema, { maxItems: 128 }),
    excluded_now: Type.Array(id, { maxItems: 500 })
  },
  { additionalProperties: false }
);
export type RunSourcesView = Static<typeof RunSourcesViewSchema>;
