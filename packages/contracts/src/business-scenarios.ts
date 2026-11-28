/** Additive contracts for the deterministic Harness 2 business procedure runner.
 * Existing shared DTOs are deliberately untouched. */
import { Type, type Static } from "typebox";

export const BUSINESS_SCENARIO_IDS = [
  "BIZ-013",
  "BIZ-014",
  "BIZ-016",
  "BIZ-017",
  "BIZ-021",
  "BIZ-023",
  "BIZ-024",
  "BIZ-038",
  "BIZ-040",
  "BIZ-042",
  "BIZ-046",
  "BIZ-072"
] as const;

export const BusinessScenarioIdSchema = Type.Union(
  BUSINESS_SCENARIO_IDS.map((id) => Type.Literal(id)) as [
    ReturnType<typeof Type.Literal>,
    ...ReturnType<typeof Type.Literal>[]
  ]
);
export type BusinessScenarioId = (typeof BUSINESS_SCENARIO_IDS)[number];

/** Scenario payloads are intentionally open: each procedure documents its own
 * required fields and reports gaps rather than inventing missing values. */
export const BusinessScenarioInputSchema = Type.Record(Type.String(), Type.Unknown(), {
  minProperties: 1,
  maxProperties: 64
});
export type BusinessScenarioInput = Static<typeof BusinessScenarioInputSchema>;

export const BusinessScenarioRunRequestSchema = Type.Object(
  {
    scenario_id: BusinessScenarioIdSchema,
    input: BusinessScenarioInputSchema
  },
  { additionalProperties: false }
);
export type BusinessScenarioRunRequest = Static<typeof BusinessScenarioRunRequestSchema>;

export const BusinessScenarioCheckSchema = Type.Object(
  {
    criterion: Type.String({ minLength: 1, maxLength: 120 }),
    passed: Type.Boolean(),
    detail: Type.String({ minLength: 1, maxLength: 2000 })
  },
  { additionalProperties: false }
);
export type BusinessScenarioCheck = Static<typeof BusinessScenarioCheckSchema>;

export const BusinessScenarioGapSchema = Type.Object(
  {
    field: Type.String({ minLength: 1, maxLength: 240 }),
    detail: Type.String({ minLength: 1, maxLength: 2000 })
  },
  { additionalProperties: false }
);
export type BusinessScenarioGap = Static<typeof BusinessScenarioGapSchema>;

/** Every artifact carries a `kind` discriminator: text | table | register |
 * calculation | checklist | gaps. Remaining fields are scenario-specific. */
export const BusinessScenarioArtifactSchema = Type.Record(Type.String(), Type.Unknown(), {
  minProperties: 1
});
export type BusinessScenarioArtifact = Static<typeof BusinessScenarioArtifactSchema>;

export const BusinessScenarioRunResultSchema = Type.Object(
  {
    format: Type.String({ minLength: 1, maxLength: 120 }),
    scenario_id: BusinessScenarioIdSchema,
    artifact: BusinessScenarioArtifactSchema,
    checks: Type.Array(BusinessScenarioCheckSchema),
    gaps: Type.Array(BusinessScenarioGapSchema),
    needs_answer: Type.Boolean()
  },
  { additionalProperties: false }
);
export type BusinessScenarioRunResult = Static<typeof BusinessScenarioRunResultSchema>;

export const BUSINESS_SCENARIO_RUN_PATH = "/api/v1/business-scenarios/run";
