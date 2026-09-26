import { describe, expect, it } from "vitest";
import { openDatabase, ProjectStore, runMigrations, UsageStore } from "../src/index.js";

const reservation = {
  attempt: 0,
  registry_version: "test",
  provider_id: "test",
  model_id: "test",
  estimated_input_tokens: 50,
  max_output_tokens: 50,
  estimated_cost: { amount: 1, currency: "USD" } as const
};

describe("uncertain provider charges", () => {
  it.each(["attempt_failure", "run_failure", "cancel", "restart"])(
    "holds budget after %s",
    async (failure) => {
      const db = openDatabase(":memory:");
      try {
        await runMigrations(db);
        const projects = new ProjectStore(db.sqlite);
        const usage = new UsageStore(db.sqlite);
        const first = projects.createProject("test", "first");
        usage.ensureLimit(first.project.id);
        usage.updateLimit(first.project.id, {
          expected_version: 1,
          max_total_tokens: 100,
          max_cost: null
        });
        const message = projects.startAssistantMessage(first.run.id)!;
        projects.reserveModelUsage(first.run.id, reservation);
        projects.appendAssistantDelta(message.id, "paid partial output");
        if (failure === "attempt_failure")
          projects.failModelUsage(first.run.id, 0, "PROVIDER_ERROR");
        if (failure === "run_failure") projects.failRun(first.run.id, "PROVIDER_ERROR");
        if (failure === "cancel") projects.cancelRun(first.run.id);
        if (failure === "restart") projects.recoverInterruptedRuns();
        const next = projects.createMessage(first.project.id, "next", "next")!;
        expect(() => projects.reserveModelUsage(next.run.id, reservation)).toThrow(
          expect.objectContaining({ code: "PROJECT_TOKEN_LIMIT_EXCEEDED" })
        );
        usage.updateLimit(first.project.id, {
          expected_version: 2,
          max_total_tokens: null,
          max_cost: { amount: 1, currency: "USD" }
        });
        expect(() => projects.reserveModelUsage(next.run.id, reservation)).toThrow(
          expect.objectContaining({ code: "PROJECT_COST_LIMIT_EXCEEDED" })
        );
        expect(usage.getProjectSummary(first.project.id)).toMatchObject({
          tokens: { reserved_upper_bound: 100 },
          costs: [{ currency: "USD", reserved_amount: 1 }]
        });
      } finally {
        db.close();
      }
    }
  );

  it("releases unused reservation only after authoritative successful usage", async () => {
    const db = openDatabase(":memory:");
    try {
      await runMigrations(db);
      const projects = new ProjectStore(db.sqlite),
        usage = new UsageStore(db.sqlite);
      const first = projects.createProject("test", "first");
      usage.ensureLimit(first.project.id);
      usage.updateLimit(first.project.id, {
        expected_version: 1,
        max_total_tokens: 110,
        max_cost: null
      });
      projects.reserveModelUsage(first.run.id, reservation);
      projects.completeRun(
        first.run.id,
        "test",
        "test",
        { inputTokens: 5, outputTokens: 5 },
        { attempt: 0, calculatedCost: { amount: 0.1, currency: "USD" } }
      );
      const next = projects.createMessage(first.project.id, "next", "next")!;
      expect(projects.reserveModelUsage(next.run.id, reservation)?.status).toBe("reserved");
    } finally {
      db.close();
    }
  });
});
