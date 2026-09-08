import { EmergencyStopStore, openDatabase, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { RuntimeMetrics } from "../src/operations.js";

describe("RuntimeMetrics detached run scope", () => {
  it("does not expose another owner's detached active-run count", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    try {
      const stopStore = new EmergencyStopStore(database.sqlite);
      const metrics = new RuntimeMetrics();

      metrics.detachedRunStarted("owner-a");
      metrics.detachedRunStarted("owner-b");

      expect(metrics.snapshot(stopStore, 0, "owner-a").active_runs).toBe(1);
      expect(metrics.snapshot(stopStore, 0, "owner-b").active_runs).toBe(1);
      expect(metrics.snapshot(stopStore, 0).active_runs).toBe(2);

      metrics.detachedRunFinished("owner-a");
      expect(metrics.snapshot(stopStore, 0, "owner-a").active_runs).toBe(0);
      expect(metrics.snapshot(stopStore, 0, "owner-b").active_runs).toBe(1);
    } finally {
      database.close();
    }
  });
});
