import { describe, expect, it } from "vitest";
import type { RuntimeCheckpoint, RuntimeTaskGraph } from "@cosmora/contracts";
import {
  DemoManagerStore,
  DemoManagerStoreValidationError,
  ProjectStore,
  openDatabase,
  runMigrations
} from "../src/index.js";

const createdAt = "2026-09-10T10:00:00.000Z";

const graph = (projectId: string): RuntimeTaskGraph => ({
  contract_version: 1,
  graph_id: "graph-1",
  project_id: projectId,
  root_task_id: "task-plan",
  nodes: [
    {
      task_id: "task-plan",
      project_id: projectId,
      assigned_role: "manager",
      status: "pending",
      depends_on: [],
      input_artifact_ids: [],
      expected_output_kinds: ["plan"],
      memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
      max_iterations: 1,
      timeout_ms: 30_000,
      created_at: createdAt
    }
  ],
  created_at: createdAt
});

describe("DemoManagerStore", () => {
  it("persists a source-bound plan, artifacts and checkpoint without crossing owners", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const accepted = projects.createProject("Подготовь демо", "demo-source-1");
      const store = new DemoManagerStore(database.sqlite);
      const created = store.create({
        projectId: accepted.project.id,
        sourceRunId: accepted.run.id,
        ownerGoal: " Подготовь  демо  ",
        graph: graph(accepted.project.id)
      });

      expect(created).toMatchObject({
        project_id: accepted.project.id,
        source_run_id: accepted.run.id,
        owner_goal: "Подготовь демо",
        status: "queued"
      });
      expect(
        store.create({
          projectId: accepted.project.id,
          sourceRunId: accepted.run.id,
          ownerGoal: "Подготовь демо",
          graph: graph(accepted.project.id)
        })?.demo_run_id
      ).toBe(created?.demo_run_id);
      expect(store.claim(created?.demo_run_id ?? "missing")).toBe(true);
      expect(
        store.appendArtifact({
          demo_run_id: created?.demo_run_id ?? "missing",
          project_id: accepted.project.id,
          task_id: "task-plan",
          kind: "plan",
          content: "Проверить документацию"
        })
      ).toMatchObject({ kind: "plan", project_id: accepted.project.id });

      const checkpoint: RuntimeCheckpoint = {
        contract_version: 1,
        checkpoint_id: "checkpoint-1",
        project_id: accepted.project.id,
        graph_id: "graph-1",
        task_states: [{ task_id: "task-plan", status: "completed" }],
        artifact_ids: store
          .listArtifacts(created?.demo_run_id ?? "missing")
          .map((artifact) => artifact.artifact_id),
        open_conflict_ids: [],
        restores_permissions: false,
        restores_sessions: false,
        restores_autonomy_escalation: false,
        created_at: createdAt
      };
      expect(store.complete(created?.demo_run_id ?? "missing", checkpoint)).toMatchObject({
        status: "succeeded",
        checkpoint
      });
      expect(
        store.appendArtifact({
          demo_run_id: created?.demo_run_id ?? "missing",
          project_id: accepted.project.id,
          task_id: "task-plan",
          kind: "checkpoint",
          content: "late write"
        })
      ).toBeNull();
      expect(store.get(created?.demo_run_id ?? "missing", "other-owner")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("rejects a graph that does not belong to its source project", async () => {
    const database = openDatabase(":memory:");
    try {
      await runMigrations(database);
      const projects = new ProjectStore(database.sqlite);
      const accepted = projects.createProject("Подготовь демо", "demo-source-2");
      const store = new DemoManagerStore(database.sqlite);
      expect(() =>
        store.create({
          projectId: accepted.project.id,
          sourceRunId: accepted.run.id,
          ownerGoal: "Подготовь демо",
          graph: graph("other-project")
        })
      ).toThrow(DemoManagerStoreValidationError);
    } finally {
      database.close();
    }
  });
});
