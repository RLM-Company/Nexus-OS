import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EmergencyStopStore,
  IdempotencyConflictError,
  openDatabase,
  ProjectStore,
  runMigrations
} from "../src/index.js";

describe("SQLite foundation", () => {
  it("applies migrations to a clean database", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const row = database.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("cosmora_system_metadata") as { name?: string } | undefined;

      expect(row?.name).toBe("cosmora_system_metadata");
      expect(
        database.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get("emergency_stops")
      ).toMatchObject({ name: "emergency_stops" });
    } finally {
      database.close();
    }
  });

  it("can run the migration runner repeatedly", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      await runMigrations(database);
      expect(() => database.ping()).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("persists projects, messages, runs and idempotency records", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const store = new ProjectStore(database.sqlite);
      const accepted = store.createProject("Запусти тестовый проект", "client-project-1");
      const duplicate = store.createProject("Запусти тестовый проект", "client-project-1");

      expect(accepted.duplicate).toBe(false);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.project.id).toBe(accepted.project.id);
      expect(store.listProjects()).toHaveLength(1);
      expect(store.listMessages(accepted.project.id)).toHaveLength(1);

      const assistant = store.startAssistantMessage(accepted.run.id);
      expect(assistant?.status).toBe("streaming");
      store.reserveModelUsage(accepted.run.id, {
        attempt: 0,
        registry_version: "test-registry-1",
        provider_id: "mock",
        model_id: "manager-test",
        estimated_input_tokens: 20,
        max_output_tokens: 100,
        estimated_cost: { amount: 0, currency: "USD" }
      });
      store.appendAssistantDelta(assistant?.id ?? "", "Готово");
      store.completeRun(
        accepted.run.id,
        "mock",
        "manager-test",
        { inputTokens: 12, outputTokens: 4 },
        { attempt: 0, calculatedCost: { amount: 0, currency: "USD" } }
      );

      expect(store.getRun(accepted.run.id)).toMatchObject({
        status: "succeeded",
        input_tokens: 12,
        output_tokens: 4
      });
      expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
        content: "Готово",
        status: "completed"
      });
      expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
        expect.objectContaining({
          status: "committed",
          registry_version: "test-registry-1",
          provider_id: "mock",
          model_requested: "manager-test",
          model_resolved: "manager-test",
          actual_input_tokens: 12,
          actual_output_tokens: 4,
          calculated_cost_amount: 0,
          currency: "USD"
        })
      ]);
      store.failRun(accepted.run.id, "LATE_ERROR");
      expect(store.getRun(accepted.run.id)).toMatchObject({ status: "succeeded" });
      expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({ status: "completed" });
      expect(store.getModelUsageForRun(accepted.run.id)[0]).toMatchObject({
        status: "committed",
        error_code: null
      });
      expect(() =>
        store.createProject("Другой запрос с тем же ключом", "client-project-1")
      ).toThrow(IdempotencyConflictError);
    } finally {
      database.close();
    }
  });

  it("keeps projects, messages and runs inside the owner boundary", async () => {
    const database = openDatabase(":memory:");

    try {
      await runMigrations(database);
      const store = new ProjectStore(database.sqlite);
      const hidden = store.createProject("Чужой проект", "other-client-1", "other-owner");

      expect(store.listProjects()).toHaveLength(0);
      expect(store.getProject(hidden.project.id)).toBeNull();
      expect(store.getMainChatId(hidden.project.id)).toBeNull();
      expect(store.listMessages(hidden.project.id)).toHaveLength(0);
      expect(store.getRun(hidden.run.id)).toBeNull();
      expect(store.getProject(hidden.project.id, "other-owner")).not.toBeNull();
      expect(store.getRun(hidden.run.id, "other-owner")).not.toBeNull();
    } finally {
      database.close();
    }
  });

  it("persists fail-closed process and owner-bound project emergency stops", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-stop-test-"));
    const file = join(directory, "cosmora.db");
    const first = openDatabase(file);
    let projectId: string;

    try {
      await runMigrations(first);
      const projects = new ProjectStore(first.sqlite);
      const stops = new EmergencyStopStore(first.sqlite);
      projectId = projects.createProject("Останови проект", "stop-project-1").project.id;
      const hidden = projects.createProject("Чужой проект", "stop-other-1", "other-owner").project
        .id;

      expect(stops.activateProject(projectId, "Owner requested stop")).toMatchObject({
        scope: "project",
        project_id: projectId,
        active: true
      });
      expect(stops.activateProject(hidden, "Unauthorized stop")).toBeNull();
      expect(stops.countActiveProjectStops()).toBe(1);
      expect(stops.activateProcess("Incident containment", "system:operator")).toMatchObject({
        scope: "process",
        project_id: null,
        activated_by: "system:operator"
      });
      expect(stops.getBlockingStop(projectId)?.scope).toBe("process");
    } finally {
      first.close();
    }

    const reopened = openDatabase(file);
    try {
      await runMigrations(reopened);
      const stops = new EmergencyStopStore(reopened.sqlite);
      const processStop = stops.getProcessStop();
      const projectStop = stops.getProjectStop(projectId);
      expect(processStop).toMatchObject({ reason: "Incident containment" });
      expect(projectStop).toMatchObject({ reason: "Owner requested stop" });
      expect(
        stops.clearProcess({
          expectedActivatedAt: processStop?.activated_at ?? "missing",
          actorId: "system:recovery",
          ownerId: "local-owner",
          reason: "Provider incident resolved"
        })
      ).toMatchObject({ scope: "process", clearance_reason: "Provider incident resolved" });
      expect(stops.getBlockingStop(projectId)?.scope).toBe("project");
      expect(
        stops.clearProject(projectId, {
          expectedActivatedAt: projectStop?.activated_at ?? "missing",
          actorId: "system:recovery",
          ownerId: "local-owner",
          reason: "Project behavior verified"
        })
      ).toMatchObject({ scope: "project", project_id: projectId });
      expect(stops.getBlockingStop(projectId)).toBeNull();
      expect(stops.listRecentClearances()).toHaveLength(2);
      expect(() =>
        reopened.sqlite
          .prepare(
            "UPDATE emergency_stop_clearance_events SET clearance_reason = ? WHERE event_id = ?"
          )
          .run("Rewritten", stops.listRecentClearances()[0]?.event_id ?? "missing")
      ).toThrow(/append-only/i);
      expect(() =>
        reopened.sqlite.prepare("DELETE FROM emergency_stop_clearance_events").run()
      ).toThrow(/append-only/i);

      const environmentStop = stops.activateProcess(
        "RUNTIME_EMERGENCY_STOP environment switch",
        "system:environment"
      );
      expect(environmentStop.activated_at).not.toBe(processStop?.activated_at);
      expect(
        stops.clearProcess({
          expectedActivatedAt: environmentStop.activated_at,
          actorId: "system:recovery",
          ownerId: "local-owner",
          reason: "Attempted API recovery"
        })
      ).toBeNull();
      expect(stops.getProcessStop()).toMatchObject({ activated_by: "system:environment" });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores project history after reopening the SQLite file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-db-test-"));
    const file = join(directory, "cosmora.db");
    const first = openDatabase(file);

    try {
      await runMigrations(first);
      const store = new ProjectStore(first.sqlite);
      const accepted = store.createProject("Переживи перезапуск", "restart-1");
      const assistant = store.startAssistantMessage(accepted.run.id);
      store.appendAssistantDelta(assistant?.id ?? "", "История восстановлена");
      store.completeRun(accepted.run.id, "mock", "manager-b0.1");
    } finally {
      first.close();
    }

    const reopened = openDatabase(file);
    try {
      await runMigrations(reopened);
      const store = new ProjectStore(reopened.sqlite);
      expect(store.listProjects()).toHaveLength(1);
      expect(store.listMessages(store.listProjects()[0]?.id ?? "")).toMatchObject([
        { role: "user", status: "completed" },
        { role: "assistant", status: "completed", content: "История восстановлена" }
      ]);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails an interrupted streaming run safely after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-interrupted-test-"));
    const file = join(directory, "cosmora.db");
    const first = openDatabase(file);
    let runId: string;

    try {
      await runMigrations(first);
      const store = new ProjectStore(first.sqlite);
      const accepted = store.createProject("Начни длинный ответ", "restart-running-1");
      runId = accepted.run.id;
      const assistant = store.startAssistantMessage(runId);
      store.reserveModelUsage(runId, {
        attempt: 0,
        registry_version: "test-registry-1",
        provider_id: "mock",
        model_id: "manager-test",
        estimated_input_tokens: 20,
        max_output_tokens: 100,
        estimated_cost: null
      });
      store.appendAssistantDelta(assistant?.id ?? "", "Частичный ответ");
    } finally {
      first.close();
    }

    const reopened = openDatabase(file);
    try {
      await runMigrations(reopened);
      const store = new ProjectStore(reopened.sqlite);
      expect(store.recoverInterruptedRuns()).toBe(1);
      expect(store.getRun(runId)).toMatchObject({ status: "failed" });
      expect(store.getAssistantMessage(runId)).toMatchObject({
        status: "failed",
        error_code: "INTERRUPTED_BY_RESTART",
        content: "Частичный ответ"
      });
      expect(store.getModelUsageForRun(runId)).toEqual([
        expect.objectContaining({
          status: "failed",
          error_code: "INTERRUPTED_BY_RESTART"
        })
      ]);
      expect(store.recoverInterruptedRuns()).toBe(0);
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
