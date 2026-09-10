import { composeDemoManagerPlan } from "@cosmora/core";
import { DemoManagerStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoManagerCoordinator } from "../src/demo-manager-coordinator.js";

describe("DemoManagerCoordinator", () => {
  let database: ReturnType<typeof openDatabase>;
  let projects: ProjectStore;
  let demos: DemoManagerStore;
  let coordinator: DemoManagerCoordinator;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projects = new ProjectStore(database.sqlite);
    demos = new DemoManagerStore(database.sqlite);
    coordinator = new DemoManagerCoordinator(demos);
  });

  afterEach(() => database.close());

  const createDemo = () => {
    const accepted = projects.createProject("Подготовь демо", randomUUID());
    const plan = composeDemoManagerPlan({
      projectId: accepted.project.id,
      ownerGoal: "Подготовь план улучшения документации",
      createdAt: "2026-09-10T10:00:00.000Z",
      createId: () => randomUUID()
    });
    return demos.create({
      projectId: accepted.project.id,
      sourceRunId: accepted.run.id,
      ownerGoal: "Подготовь план улучшения документации",
      graph: plan.graph
    });
  };

  it("runs the bounded workflow once and records only synthetic artifacts", () => {
    const demo = createDemo();
    const completed = coordinator.execute(demo?.demo_run_id ?? "missing");

    expect(completed).toMatchObject({ status: "succeeded" });
    expect(completed?.checkpoint?.restores_permissions).toBe(false);
    const artifacts = demos.listArtifacts(demo?.demo_run_id ?? "missing");
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["plan", "analysis", "handoff"]);
    expect(artifacts[1]?.content).toContain("synthetic");
    expect(coordinator.execute(demo?.demo_run_id ?? "missing")).toMatchObject({
      status: "succeeded"
    });
    expect(demos.listArtifacts(demo?.demo_run_id ?? "missing")).toHaveLength(3);
  });

  it("does not execute a demo that an owner has already cancelled", () => {
    const demo = createDemo();
    expect(demos.cancel(demo?.demo_run_id ?? "missing")).toMatchObject({ status: "cancelled" });
    expect(coordinator.execute(demo?.demo_run_id ?? "missing")).toMatchObject({
      status: "cancelled"
    });
    expect(demos.listArtifacts(demo?.demo_run_id ?? "missing")).toEqual([]);
  });

  it("keeps the owner boundary when asked to execute another owner's demo", () => {
    const accepted = projects.createProject("Чужое демо", "other-demo-source", "other-owner");
    const plan = composeDemoManagerPlan({
      projectId: accepted.project.id,
      ownerGoal: "Чужая задача",
      createdAt: "2026-09-10T10:00:00.000Z",
      createId: () => randomUUID()
    });
    const demo = demos.create({
      projectId: accepted.project.id,
      sourceRunId: accepted.run.id,
      ownerGoal: "Чужая задача",
      graph: plan.graph,
      ownerId: "other-owner"
    });

    expect(coordinator.execute(demo?.demo_run_id ?? "missing")).toBeNull();
    expect(demos.get(demo?.demo_run_id ?? "missing", "other-owner")).toMatchObject({
      status: "queued"
    });
  });
});
