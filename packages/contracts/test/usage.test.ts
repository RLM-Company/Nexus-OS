import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { ProjectUsageSummarySchema } from "../src/usage.js";

describe("usage contracts", () => {
  const summary = {
    project_id: "project-usage-1",
    generated_at: "2026-09-01T20:30:00.000Z",
    attempts: { total: 3, reserved: 1, committed: 1, failed: 1, cancelled: 0 },
    tokens: {
      committed_input: 120,
      committed_output: 40,
      reserved_upper_bound: 500,
      unknown_committed_attempts: 0
    },
    costs: [{ currency: "USD", committed_amount: 0.25, reserved_amount: 0 }],
    unknown_committed_cost_attempts: 0,
    unknown_reserved_cost_attempts: 1
  } as const;

  it("accepts a content-free project usage summary", () => {
    expect(Value.Check(ProjectUsageSummarySchema, summary)).toBe(true);
  });

  it("rejects provider and request details", () => {
    expect(
      Value.Check(ProjectUsageSummarySchema, {
        ...summary,
        provider_id: "private-provider"
      })
    ).toBe(false);
    expect(
      Value.Check(ProjectUsageSummarySchema, {
        ...summary,
        tokens: { ...summary.tokens, committed_input: -1 }
      })
    ).toBe(false);
  });
});
