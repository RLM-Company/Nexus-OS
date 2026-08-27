import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerConfig } from "@cosmora/config";
import { EmergencyStopStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("B0.2 incident drill", () => {
  it("keeps a process emergency stop fail-closed across an API and database restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-b0-2-drill-"));
    const databasePath = join(directory, "runtime.sqlite");
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "slow_stream" });

    const firstDatabase = openDatabase(databasePath);
    await runMigrations(firstDatabase);
    const firstRuntime = await buildModelRuntime(config);
    const firstProjectStore = new ProjectStore(firstDatabase.sqlite);
    const firstApp = buildApp({
      config,
      database: firstDatabase,
      projectStore: firstProjectStore,
      emergencyStopStore: new EmergencyStopStore(firstDatabase.sqlite),
      modelGateway: firstRuntime.gateway,
      manager: firstRuntime.manager,
      modelRegistryVersion: firstRuntime.registryVersion
    });

    let firstClosed = false;
    let secondDatabase: ReturnType<typeof openDatabase> | undefined;
    let secondApp: ReturnType<typeof buildApp> | undefined;
    try {
      const created = await firstApp.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: {
          initial_message: "Проведи аварийную проверку после перезапуска",
          client_message_id: "b0-2-durable-stop"
        }
      });
      const body = created.json<{ run_id: string; stream_url: string }>();

      const activated = await firstApp.inject({
        method: "POST",
        url: "/api/v1/operations/emergency-stop",
        payload: { scope: "process", reason: "B0.2 durable incident drill" }
      });
      expect(activated.statusCode, activated.body).toBe(200);

      await firstApp.close();
      firstDatabase.close();
      firstClosed = true;

      secondDatabase = openDatabase(databasePath);
      await runMigrations(secondDatabase);
      const secondRuntime = await buildModelRuntime(config);
      const secondProjectStore = new ProjectStore(secondDatabase.sqlite);
      secondApp = buildApp({
        config,
        database: secondDatabase,
        projectStore: secondProjectStore,
        emergencyStopStore: new EmergencyStopStore(secondDatabase.sqlite),
        modelGateway: secondRuntime.gateway,
        manager: secondRuntime.manager,
        modelRegistryVersion: secondRuntime.registryVersion
      });

      const stream = await secondApp.inject({ method: "GET", url: body.stream_url });
      const status = await secondApp.inject({ method: "GET", url: "/api/v1/operations/status" });

      expect(stream.body).toContain("event: run.failed");
      expect(stream.body).toContain('"error_code":"EMERGENCY_STOP"');
      expect(secondProjectStore.getRun(body.run_id)).toMatchObject({ status: "failed" });
      expect(secondProjectStore.getModelUsageForRun(body.run_id)).toEqual([]);
      expect(status.json()).toMatchObject({
        active_runs: 0,
        process_stop: {
          scope: "process",
          active: true,
          reason: "B0.2 durable incident drill"
        },
        metrics: {
          runs_started: 0,
          runs_failed: 1,
          route_attempts: 0,
          route_failures: { EMERGENCY_STOP: 1 }
        },
        alerts: [expect.objectContaining({ code: "PROCESS_EMERGENCY_STOP" })]
      });
    } finally {
      if (!firstClosed) {
        await firstApp.close();
        firstDatabase.close();
      }
      if (secondApp) await secondApp.close();
      secondDatabase?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
