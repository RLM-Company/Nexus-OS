import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { CreateManagerWorkSchema } from "../src/manager-work.js";

describe("Work cumulative model budget", () => {
  const request = {
    client_request_id: "fable-work-budget",
    goal: "Prepare a verified implementation",
    worker_role: "architect",
    max_model_requests: 3,
    max_input_tokens: 1_000_000,
    max_output_tokens: 100_000
  };
  it("accepts a large-model task without the legacy 32K/8K caps", () => {
    expect(Value.Check(CreateManagerWorkSchema, request)).toBe(true);
    expect(
      Value.Check(CreateManagerWorkSchema, {
        ...request,
        max_input_tokens: 3_000_000,
        max_output_tokens: 300_000
      })
    ).toBe(true);
  });
  it("rejects invalid/unbounded budgets and excess dispatches", () => {
    for (const patch of [
      { max_input_tokens: 3_000_001 },
      { max_input_tokens: -1 },
      { max_output_tokens: 300_001 },
      { max_output_tokens: Infinity },
      { max_output_tokens: 1.5 },
      { max_model_requests: 4 }
    ])
      expect(Value.Check(CreateManagerWorkSchema, { ...request, ...patch })).toBe(false);
  });
});
