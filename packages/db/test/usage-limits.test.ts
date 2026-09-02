import { describe, expect, it } from "vitest";
import {
  openDatabase,
  ProjectStore,
  ProjectUsageLimitExceededError,
  runMigrations,
  UsageLimitConflictError,
  UsageStore
} from "../src/index.js";

const expectLimitFailure = (
  operation: () => unknown,
  code:
    | "PROJECT_TOKEN_LIMIT_EXCEEDED"
    | "PROJECT_COST_LIMIT_EXCEEDED"
    | "PROJECT_USAGE_EVIDENCE_MISSING"
): void => {
  let failure: unknown;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ProjectUsageLimitExceededError);
  expect(failure).toMatchObject({ code });
};

describe("project usage limits", () => {
  it("persists optimistic owner limits and rejects stale writes", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const usage = new UsageStore(database.sqlite);
      const project = projects.createProject("Bound project usage", "usage-limit-owner-1").project;

      const initial = usage.ensureLimit(project.id);
      expect(initial).toMatchObject({
        project_id: project.id,
        version: 1,
        max_total_tokens: null,
        max_cost: null
      });
      expect(usage.ensureLimit(project.id)).toEqual(initial);
      expect(usage.ensureLimit(project.id, "other-owner")).toBeNull();

      const updated = usage.updateLimit(
        project.id,
        {
          expected_version: 1,
          max_total_tokens: 500,
          max_cost: { amount: 1, currency: "USD" }
        },
        "local-owner",
        "2026-09-02T03:31:00.000Z"
      );
      expect(updated).toMatchObject({
        version: 2,
        max_total_tokens: 500,
        max_cost: { amount: 1, currency: "USD" },
        updated_at: "2026-09-02T03:31:00.000Z"
      });
      expect(() =>
        usage.updateLimit(project.id, {
          expected_version: 1,
          max_total_tokens: 400,
          max_cost: null
        })
      ).toThrow(UsageLimitConflictError);
    } finally {
      database.close();
    }
  });

  it("reserves once and fails closed before token or cost limits can be oversubscribed", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const usage = new UsageStore(database.sqlite);
      const first = projects.createProject("Enforce project usage", "usage-limit-enforce-1");
      usage.ensureLimit(first.project.id);
      usage.updateLimit(first.project.id, {
        expected_version: 1,
        max_total_tokens: 250,
        max_cost: { amount: 0.5, currency: "USD" }
      });

      const firstReservation = {
        attempt: 0,
        registry_version: "registry-usage-limit",
        provider_id: "provider-usage-limit",
        model_id: "model-usage-limit",
        estimated_input_tokens: 50,
        max_output_tokens: 100,
        estimated_cost: { amount: 0.3, currency: "USD" } as const
      };
      expect(projects.reserveModelUsage(first.run.id, firstReservation)).toMatchObject({
        status: "reserved",
        estimated_cost_amount: 0.3
      });
      expect(projects.reserveModelUsage(first.run.id, firstReservation)).toMatchObject({
        status: "reserved"
      });
      expect(projects.getModelUsageForRun(first.run.id)).toHaveLength(1);

      const tokenRun = projects.createMessage(
        first.project.id,
        "Try to exceed the token ceiling",
        "usage-limit-token-2"
      );
      expect(tokenRun).not.toBeNull();
      expectLimitFailure(
        () =>
          projects.reserveModelUsage(tokenRun?.run.id ?? "", {
            ...firstReservation,
            estimated_input_tokens: 20,
            max_output_tokens: 100,
            estimated_cost: { amount: 0.1, currency: "USD" }
          }),
        "PROJECT_TOKEN_LIMIT_EXCEEDED"
      );
      expect(projects.getModelUsageForRun(tokenRun?.run.id ?? "")).toEqual([]);

      usage.updateLimit(first.project.id, {
        expected_version: 2,
        max_total_tokens: 500,
        max_cost: { amount: 0.35, currency: "USD" }
      });
      const costRun = projects.createMessage(
        first.project.id,
        "Try to exceed the cost ceiling",
        "usage-limit-cost-3"
      );
      expect(costRun).not.toBeNull();
      expectLimitFailure(
        () =>
          projects.reserveModelUsage(costRun?.run.id ?? "", {
            ...firstReservation,
            estimated_input_tokens: 10,
            max_output_tokens: 10,
            estimated_cost: { amount: 0.1, currency: "USD" }
          }),
        "PROJECT_COST_LIMIT_EXCEEDED"
      );

      usage.updateLimit(first.project.id, {
        expected_version: 3,
        max_total_tokens: 500,
        max_cost: { amount: 1, currency: "USD" }
      });
      const unknownRun = projects.createMessage(
        first.project.id,
        "Reject unknown price evidence",
        "usage-limit-unknown-4"
      );
      expect(unknownRun).not.toBeNull();
      expectLimitFailure(
        () =>
          projects.reserveModelUsage(unknownRun?.run.id ?? "", {
            ...firstReservation,
            estimated_input_tokens: 10,
            max_output_tokens: 10,
            estimated_cost: null
          }),
        "PROJECT_USAGE_EVIDENCE_MISSING"
      );
    } finally {
      database.close();
    }
  });
});
