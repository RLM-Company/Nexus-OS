import { Type, type Static } from "typebox";
import { WorkDagNodeInputSchema } from "./work-dag.js";

const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const key = Type.String({ minLength: 1, maxLength: 60, pattern: "^[a-zA-Z][a-zA-Z0-9_]*$" });
export const AutomationKeySchema = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-zA-Z0-9_-]+$"
});
export const PlaybookDefinitionSchema = Type.Object(
  {
    title_template: text(160),
    variables: Type.Array(
      Type.Object(
        {
          key,
          label: text(100),
          required: Type.Boolean(),
          default_value: Type.Optional(Type.String({ maxLength: 2000 }))
        },
        { additionalProperties: false }
      ),
      { maxItems: 20 }
    ),
    nodes: Type.Array(WorkDagNodeInputSchema, { minItems: 1, maxItems: 32 })
  },
  { additionalProperties: false }
);
export type PlaybookDefinition = Static<typeof PlaybookDefinitionSchema>;
export const PlaybookSaveSchema = Type.Object(
  {
    client_request_id: AutomationKeySchema,
    title: text(160),
    definition: PlaybookDefinitionSchema
  },
  { additionalProperties: false }
);
export const PlaybookPublishSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1, maximum: 1000 }),
    title: text(160),
    definition: PlaybookDefinitionSchema,
    changelog: Type.String({ maxLength: 1000 })
  },
  { additionalProperties: false }
);
export const PlaybookInstantiateSchema = Type.Object(
  {
    client_request_id: AutomationKeySchema,
    playbook_version: Type.Integer({ minimum: 1, maximum: 1000 }),
    variables: Type.Record(key, Type.String({ maxLength: 2000 }), { maxProperties: 20 })
  },
  { additionalProperties: false }
);
export type PlaybookInstantiate = Static<typeof PlaybookInstantiateSchema>;
export const AutomationScheduleSchema = Type.Object(
  {
    client_request_id: AutomationKeySchema,
    playbook_id: AutomationKeySchema,
    playbook_version: Type.Integer({ minimum: 1, maximum: 1000 }),
    variables: PlaybookInstantiateSchema.properties.variables,
    due_at: Type.String({ minLength: 24, maxLength: 24 }),
    interval_seconds: Type.Union([Type.Null(), Type.Integer({ minimum: 60, maximum: 31_622_400 })])
  },
  { additionalProperties: false }
);
export type AutomationScheduleInput = Static<typeof AutomationScheduleSchema>;

export const EvaluationRuleSchema = Type.Object(
  {
    file: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*\\.(md|txt|json|html|css|js|ts|py|csv)$"
    }),
    kind: Type.Union([
      Type.Literal("exists"),
      Type.Literal("contains"),
      Type.Literal("not_contains"),
      Type.Literal("min_chars")
    ]),
    value: Type.Optional(
      Type.Union([Type.String({ maxLength: 1000 }), Type.Integer({ minimum: 1, maximum: 64000 })])
    )
  },
  { additionalProperties: false }
);
export type EvaluationRule = Static<typeof EvaluationRuleSchema>;
export const EvaluationSuiteSchema = Type.Object(
  {
    client_request_id: AutomationKeySchema,
    title: text(160),
    rules: Type.Array(EvaluationRuleSchema, { minItems: 1, maxItems: 30 })
  },
  { additionalProperties: false }
);
export type EvaluationSuiteInput = Static<typeof EvaluationSuiteSchema>;
export const EvidenceReferenceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("canvas"),
      Type.Literal("work"),
      Type.Literal("memory"),
      Type.Literal("document")
    ]),
    id: Type.String({ minLength: 1, maxLength: 160 }),
    version: Type.Union([
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null()
    ]),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    chunk_id: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    start: Type.Integer({ minimum: 0, maximum: 8_000_000 }),
    end: Type.Integer({ minimum: 1, maximum: 8_000_000 }),
    excerpt_sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
  },
  { additionalProperties: false }
);
export type EvidenceReference = Static<typeof EvidenceReferenceSchema>;
export const KnowledgeCollectionSchema = Type.Object(
  {
    client_request_id: AutomationKeySchema,
    title: text(160),
    references: Type.Array(EvidenceReferenceSchema, { minItems: 1, maxItems: 6 })
  },
  { additionalProperties: false }
);
export type KnowledgeCollectionInput = Static<typeof KnowledgeCollectionSchema>;
