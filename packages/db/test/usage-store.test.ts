import { describe, expect, it } from "vitest";
import { openDatabase, ProjectStore, runMigrations, UsageStore } from "../src/index.js";

describe("UsageStore", () => {
  it("aggregates exact owner-visible usage without route details", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const usage = new UsageStore(database.sqlite);
      const first = projects.createProject("Track exact usage", "usage-project-1");
      projects.startAssistantMessage(first.run.id);
      projects.reserveModelUsage(first.run.id, {
        attempt: 0,
        registry_version: "registry-private-1",
        provider_id: "provider-private-1",
        model_id: "model-private-1",
        estimated_input_tokens: 20,
        max_output_tokens: 100,
        estimated_cost: { amount: 0.3, currency: "USD" }
      });
      projects.completeRun(
        first.run.id,
        "provider-private-1",
        "model-private-1",
        { inputTokens: 12, outputTokens: 4 },
        { attempt: 0, calculatedCost: { amount: 0.25, currency: "USD" } }
      );

      const reserved = projects.createMessage(
        first.project.id,
        "Reserve another run",
        "usage-run-2"
      );
      expect(reserved).not.toBeNull();
      projects.reserveModelUsage(reserved?.run.id ?? "", {
        attempt: 0,
        registry_version: "registry-private-1",
        provider_id: "provider-private-1",
        model_id: "model-private-1",
        estimated_input_tokens: 30,
        max_output_tokens: 90,
        estimated_cost: null
      });

      const failed = projects.createMessage(first.project.id, "Fail another run", "usage-run-3");
      expect(failed).not.toBeNull();
      projects.reserveModelUsage(failed?.run.id ?? "", {
        attempt: 0,
        registry_version: "registry-private-1",
        provider_id: "provider-private-1",
        model_id: "model-private-1",
        estimated_input_tokens: 10,
        max_output_tokens: 20,
        estimated_cost: { amount: 1, currency: "RUB" }
      });
      projects.failRun(failed?.run.id ?? "", "PROVIDER_ERROR");

      const summary = usage.getProjectSummary(
        first.project.id,
        "local-owner",
        "2026-09-01T20:30:00.000Z"
      );
      expect(summary).toEqual({
        project_id: first.project.id,
        generated_at: "2026-09-01T20:30:00.000Z",
        attempts: { total: 3, reserved: 1, committed: 1, failed: 1, cancelled: 0 },
        tokens: {
          committed_input: 12,
          committed_output: 4,
          reserved_upper_bound: 150,
          unknown_committed_attempts: 0
        },
        costs: [
          { currency: "RUB", committed_amount: 0, reserved_amount: 1 },
          { currency: "USD", committed_amount: 0.25, reserved_amount: 0 }
        ],
        unknown_committed_cost_attempts: 0,
        unknown_reserved_cost_attempts: 1
      });
      expect(JSON.stringify(summary)).not.toContain("provider-private-1");
      expect(JSON.stringify(summary)).not.toContain("model-private-1");
      expect(JSON.stringify(summary)).not.toContain("registry-private-1");
      expect(usage.getProjectSummary(first.project.id, "other-owner")).toBeNull();
    } finally {
      database.close();
    }
  });
});
