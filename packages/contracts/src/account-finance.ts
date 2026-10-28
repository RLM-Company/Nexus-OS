import { Type, type Static } from "typebox";
import { CurrencySchema, IsoDateTimeSchema } from "./primitives.js";

const count = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const AccountFinanceSummarySchema = Type.Object(
  {
    schema_version: Type.Literal(1),
    generated_at: IsoDateTimeSchema,
    cost_basis: Type.Literal("recorded_calculation"),
    provider_invoice_reconciled: Type.Literal(false),
    coverage: Type.Union([
      Type.Literal("empty"),
      Type.Literal("complete"),
      Type.Literal("partial"),
      Type.Literal("unknown")
    ]),
    attempts: Type.Object(
      {
        total: count(),
        committed: count(),
        unsettled: count(),
        cancelled_before_dispatch: count()
      },
      { additionalProperties: false }
    ),
    tokens: Type.Object(
      {
        actual_input: count(),
        actual_output: count(),
        unknown_committed_attempts: count(),
        unsettled_upper_bound: count()
      },
      { additionalProperties: false }
    ),
    currencies: Type.Array(
      Type.Object(
        {
          currency: CurrencySchema,
          calculated_committed_amount: Type.Number({ minimum: 0 }),
          estimated_unsettled_amount: Type.Number({ minimum: 0 }),
          priced_committed_attempts: count(),
          priced_unsettled_attempts: count()
        },
        { additionalProperties: false }
      ),
      { maxItems: 2 }
    ),
    unknown_cost: Type.Object(
      { committed_attempts: count(), unsettled_attempts: count() },
      { additionalProperties: false }
    ),
    holds: Type.Object(
      {
        reserved: count(),
        uncertain: count(),
        orphaned_attempts: count(),
        orphaned_upper_bound: count()
      },
      { additionalProperties: false }
    ),
    invalid_records: count()
  },
  { additionalProperties: false }
);
export type AccountFinanceSummary = Static<typeof AccountFinanceSummarySchema>;
