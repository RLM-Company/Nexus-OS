import { loadServerConfig } from "@cosmora/config";
import { EmergencyStopStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { StepUpProofConsumption } from "../src/identity.js";

describe("emergency-stop clearance API", () => {
  const config = loadServerConfig({ NODE_ENV: "test" });
  let database: ReturnType<typeof openDatabase>;
  let projectStore: ProjectStore;
  let stopStore: EmergencyStopStore;
  let app: ReturnType<typeof buildApp>;
  let consumedStepUps: StepUpProofConsumption[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projectStore = new ProjectStore(database.sqlite);
    stopStore = new EmergencyStopStore(database.sqlite);
    consumedStepUps = [];
    app = buildApp({
      config,
      database,
      projectStore,
      emergencyStopStore: stopStore,
      stepUpProofConsumer: {
        consume: (input) => {
          consumedStepUps.push(input);
          return Promise.resolve(input.token === "valid-step-up");
        }
      }
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("binds project clearance to the exact activation and records an append-only event", async () => {
    const projectId = projectStore.createProject(
      "Recover a contained project",
      "clear-project-stop-1"
    ).project.id;
    const active = stopStore.activateProject(projectId, "Unexpected project behavior");
    expect(active).not.toBeNull();

    const payload = {
      scope: "project",
      project_id: projectId,
      expected_activated_at: active?.activated_at,
      reason: "Owner verified the recovery checklist",
      acknowledgement: "CLEAR EMERGENCY STOP"
    };
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload: { ...payload, expected_activated_at: "2026-09-01T00:00:00.000Z" }
    });
    expect(stale.statusCode).toBe(409);
    expect(consumedStepUps).toHaveLength(0);

    const withoutStepUp = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      payload
    });
    expect(withoutStepUp.statusCode).toBe(403);
    expect(stopStore.getProjectStop(projectId)).not.toBeNull();

    const cleared = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({
      scope: "project",
      project_id: projectId,
      activation_reason: "Unexpected project behavior",
      activated_at: active?.activated_at,
      clearance_reason: "Owner verified the recovery checklist",
      cleared_by: "local-owner"
    });
    expect(stopStore.getProjectStop(projectId)).toBeNull();
    expect(consumedStepUps).toHaveLength(1);
    expect(consumedStepUps[0]).toMatchObject({
      token: "valid-step-up",
      purpose: "emergency_stop_clearance",
      challenge: `emergency-stop-clearance:${JSON.stringify({
        scope: "project",
        project_id: projectId,
        activated_at: active?.activated_at
      })}`
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload
    });
    expect(replay.statusCode).toBe(409);
    expect(consumedStepUps).toHaveLength(1);

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/operations/emergency-stop/clearance-events?limit=10"
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json()).toMatchObject({
      limit: 10,
      items: [
        {
          scope: "project",
          project_id: projectId,
          activated_at: active?.activated_at,
          clearance_reason: "Owner verified the recovery checklist"
        }
      ]
    });
  });

  it("does not clear an environment-triggered process stop", async () => {
    const active = stopStore.activateProcess(
      "RUNTIME_EMERGENCY_STOP environment switch",
      "system:environment"
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload: {
        scope: "process",
        expected_activated_at: active.activated_at,
        reason: "Attempt to resume from the owner API",
        acknowledgement: "CLEAR EMERGENCY STOP"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "ENVIRONMENT_EMERGENCY_STOP_LOCKED"
    );
    expect(consumedStepUps).toHaveLength(0);
    expect(stopStore.getProcessStop()).toMatchObject({ activated_by: "system:environment" });
    expect(stopStore.listRecentClearances()).toEqual([]);
  });

  it("clears an owner-triggered process stop without a project binding", async () => {
    const active = stopStore.activateProcess("Owner-contained provider incident");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload: {
        scope: "process",
        expected_activated_at: active.activated_at,
        reason: "Provider health and queued work verified",
        acknowledgement: "CLEAR EMERGENCY STOP"
      }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ scope: "process", project_id: null });
    expect(stopStore.getProcessStop()).toBeNull();
    expect(consumedStepUps[0]).toMatchObject({
      purpose: "emergency_stop_clearance",
      challenge: `emergency-stop-clearance:${JSON.stringify({
        scope: "process",
        project_id: null,
        activated_at: active.activated_at
      })}`
    });
  });

  it("does not disclose another owner's project during clearance", async () => {
    const hidden = projectStore.createProject(
      "Hidden project",
      "clear-project-stop-hidden",
      "other-owner"
    ).project.id;
    const active = stopStore.activateProject(
      hidden,
      "Other owner containment",
      "other-owner-actor",
      "other-owner"
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop/clearance",
      headers: { "x-step-up-token": "valid-step-up" },
      payload: {
        scope: "project",
        project_id: hidden,
        expected_activated_at: active?.activated_at,
        reason: "Unauthorized recovery attempt",
        acknowledgement: "CLEAR EMERGENCY STOP"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Other owner containment");
    expect(consumedStepUps).toHaveLength(0);
    expect(stopStore.getProjectStop(hidden, "other-owner")).not.toBeNull();
  });
});
