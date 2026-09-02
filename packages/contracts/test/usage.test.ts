import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ProjectUsageLimitPreviewResponseSchema,
  ProjectUsageLimitSchema,
  ProjectUsageSummarySchema,
  UpdateProjectUsageLimitRequestSchema
} from "../src/usage.js";

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

  it("accepts versioned project limits and rejects unsafe values", () => {
    const limit = {
      project_id: "project-usage-1",
      version: 2,
      max_total_tokens: 20_000,
      max_cost: { amount: 15, currency: "USD" },
      created_at: "2026-09-02T03:30:00.000Z",
      updated_at: "2026-09-02T03:31:00.000Z"
    } as const;
    expect(Value.Check(ProjectUsageLimitSchema, limit)).toBe(true);
    expect(
      Value.Check(ProjectUsageLimitPreviewResponseSchema, {
        current_version: 1,
        proposed_limit: limit,
        requires_step_up: false
      })
    ).toBe(true);
    expect(
      Value.Check(UpdateProjectUsageLimitRequestSchema, {
        expected_version: 1,
        max_total_tokens: 0,
        max_cost: null
      })
    ).toBe(false);
    expect(
      Value.Check(UpdateProjectUsageLimitRequestSchema, {
        expected_version: 1,
        max_total_tokens: null,
        max_cost: { amount: 0, currency: "USD" }
      })
    ).toBe(false);
  });
});
