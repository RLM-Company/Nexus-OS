import { describe, expect, it } from "vitest";
import {
  autonomyProfileStepUpChallenge,
  projectUsageLimitStepUpChallenge
} from "../src/step-up-challenge.js";

describe("mutation-bound step-up challenges", () => {
  it("changes when the proposed autonomy authority changes", () => {
    const a6 = autonomyProfileStepUpChallenge("project-1", {
      base_level: "A6",
      overrides: [],
      expected_version: 1
    });
    const bounded = autonomyProfileStepUpChallenge("project-1", {
      base_level: "A0",
      overrides: [
        {
          override_id: "one-write",
          capability_id: "workspace.write",
          mode: "FULL",
          object_ids: ["artifact-1"],
          purpose: "Write one exact artifact",
          valid_until: null,
          remaining_uses: 1
        }
      ],
      expected_version: 1
    });

    expect(a6).not.toBe(bounded);
    expect(a6).toMatch(/^project:project-1:autonomy-profile:1:[A-Za-z0-9_-]{43}$/);
    expect(a6).toHaveLength(80);
  });

  it("changes when the proposed usage ceiling changes", () => {
    const bounded = projectUsageLimitStepUpChallenge("project-1", {
      expected_version: 2,
      max_total_tokens: 200,
      max_cost: { amount: 3, currency: "USD" }
    });
    const unlimited = projectUsageLimitStepUpChallenge("project-1", {
      expected_version: 2,
      max_total_tokens: null,
      max_cost: null
    });

    expect(bounded).not.toBe(unlimited);
    expect(bounded).toMatch(/^project:project-1:usage-limit:2:[A-Za-z0-9_-]{43}$/);
    expect(bounded).toHaveLength(75);
  });
});
