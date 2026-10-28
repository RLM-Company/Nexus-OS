import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { AccountFinanceSummarySchema } from "../src/account-finance.js";

const report = {
  schema_version: 1,
  generated_at: "2026-10-28T00:00:00.000Z",
  cost_basis: "recorded_calculation",
  provider_invoice_reconciled: false,
  coverage: "unknown",
  attempts: { total: 1, committed: 1, unsettled: 0, cancelled_before_dispatch: 0 },
  tokens: {
    actual_input: 10,
    actual_output: 5,
    unknown_committed_attempts: 0,
    unsettled_upper_bound: 0
  },
  currencies: [],
  unknown_cost: { committed_attempts: 1, unsettled_attempts: 0 },
  holds: { reserved: 0, uncertain: 1, orphaned_attempts: 0, orphaned_upper_bound: 0 },
  invalid_records: 0
} as const;

describe("financial summary boundary", () => {
  it("represents known tokens with unknown money without inventing zero-priced currency totals", () => {
    expect(Value.Check(AccountFinanceSummarySchema, report)).toBe(true);
  });
  it("cannot claim that a model price calculation is a reconciled provider invoice", () => {
    expect(
      Value.Check(AccountFinanceSummarySchema, { ...report, provider_invoice_reconciled: true })
    ).toBe(false);
    expect(
      Value.Check(AccountFinanceSummarySchema, { ...report, cost_basis: "provider_invoice" })
    ).toBe(false);
  });
  it("rejects secret fields, negative accounting and unsupported currency units", () => {
    expect(Value.Check(AccountFinanceSummarySchema, { ...report, api_key: "secret" })).toBe(false);
    expect(
      Value.Check(AccountFinanceSummarySchema, {
        ...report,
        holds: { ...report.holds, uncertain: -1 }
      })
    ).toBe(false);
    expect(
      Value.Check(AccountFinanceSummarySchema, {
        ...report,
        currencies: [
          {
            currency: "UNKNOWN",
            calculated_committed_amount: 0,
            estimated_unsettled_amount: 0,
            priced_committed_attempts: 1,
            priced_unsettled_attempts: 0
          }
        ]
      })
    ).toBe(false);
  });
});
