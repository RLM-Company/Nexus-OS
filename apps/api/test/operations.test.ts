import { EmergencyStopStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeMetrics } from "../src/operations.js";

describe("runtime operations metrics", () => {
  let database: ReturnType<typeof openDatabase>;
  let stops: EmergencyStopStore;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    stops = new EmergencyStopStore(database.sqlite);
  });

  afterEach(() => database.close());

  it("derives content-free circuit and emergency-stop alerts", () => {
    const projectId = new ProjectStore(database.sqlite).createProject(
      "Observe safely",
      "operations-1"
    ).project.id;
    const metrics = new RuntimeMetrics();

    metrics.runStarted();
    metrics.routeSelected();
    metrics.routeFailed("CIRCUIT_OPEN");
    metrics.runFailed("ROUTE_UNAVAILABLE");
    stops.activateProject(projectId, "Contain project");

    expect(metrics.snapshot(stops, 0)).toMatchObject({
      active_runs: 0,
      active_project_stops: 1,
      metrics: {
        runs_started: 1,
        runs_failed: 1,
        route_attempts: 1,
        route_failures: { CIRCUIT_OPEN: 1 }
      },
      alerts: [
        expect.objectContaining({ code: "PROJECT_EMERGENCY_STOP" }),
        expect.objectContaining({ code: "MODEL_CIRCUIT_OPEN" })
      ]
    });
  });
});
