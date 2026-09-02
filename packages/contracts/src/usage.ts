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
