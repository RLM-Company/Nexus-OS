import { Type, type Static } from "typebox";
import { CurrencySchema, EntityIdSchema, IsoDateTimeSchema } from "./primitives.js";

const UsageAttemptCountsSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    reserved: Type.Integer({ minimum: 0 }),
    committed: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    cancelled: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);

const UsageTokenTotalsSchema = Type.Object(
  {
    committed_input: Type.Integer({ minimum: 0 }),
    committed_output: Type.Integer({ minimum: 0 }),
    reserved_upper_bound: Type.Integer({ minimum: 0 }),
    unknown_committed_attempts: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);

export const UsageCurrencyTotalSchema = Type.Object(
  {
    currency: CurrencySchema,
    committed_amount: Type.Number({ minimum: 0 }),
    reserved_amount: Type.Number({ minimum: 0 })
  },
  { additionalProperties: false }
);
export type UsageCurrencyTotal = Static<typeof UsageCurrencyTotalSchema>;

export const ProjectUsageSummarySchema = Type.Object(
  {
    project_id: EntityIdSchema,
    generated_at: IsoDateTimeSchema,
    attempts: UsageAttemptCountsSchema,
    tokens: UsageTokenTotalsSchema,
    costs: Type.Array(UsageCurrencyTotalSchema, { maxItems: 2 }),
    unknown_committed_cost_attempts: Type.Integer({ minimum: 0 }),
    unknown_reserved_cost_attempts: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
export type ProjectUsageSummary = Static<typeof ProjectUsageSummarySchema>;

const NullableProjectTokenLimitSchema = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

const NullableProjectCostLimitSchema = Type.Union([
  Type.Object(
    {
      amount: Type.Number({ exclusiveMinimum: 0 }),
      currency: CurrencySchema
    },
    { additionalProperties: false }
  ),
  Type.Null()
]);

export const ProjectUsageLimitSchema = Type.Object(
  {
    project_id: EntityIdSchema,
    version: Type.Integer({ minimum: 1 }),
    max_total_tokens: NullableProjectTokenLimitSchema,
    max_cost: NullableProjectCostLimitSchema,
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema
  },
  { additionalProperties: false }
);
export type ProjectUsageLimit = Static<typeof ProjectUsageLimitSchema>;

export const UpdateProjectUsageLimitRequestSchema = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 1 }),
    max_total_tokens: NullableProjectTokenLimitSchema,
    max_cost: NullableProjectCostLimitSchema
  },
  { additionalProperties: false }
);
export type UpdateProjectUsageLimitRequest = Static<typeof UpdateProjectUsageLimitRequestSchema>;

export const ProjectUsageLimitResponseSchema = Type.Object(
  { limit: ProjectUsageLimitSchema },
  { additionalProperties: false }
);
export type ProjectUsageLimitResponse = Static<typeof ProjectUsageLimitResponseSchema>;

export const ProjectUsageLimitPreviewResponseSchema = Type.Object(
  {
    current_version: Type.Integer({ minimum: 1 }),
    proposed_limit: ProjectUsageLimitSchema,
    requires_step_up: Type.Boolean()
  },
  { additionalProperties: false }
);
export type ProjectUsageLimitPreviewResponse = Static<
  typeof ProjectUsageLimitPreviewResponseSchema
>;
