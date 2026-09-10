import { loadServerConfig } from "@cosmora/config";
import { DemoManagerStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DemoManagerCoordinator } from "../src/demo-manager-coordinator.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("Manager demo API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let projects: ProjectStore;
  let demos: DemoManagerStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    projects = new ProjectStore(database.sqlite);
    demos = new DemoManagerStore(database.sqlite);
    const runtime = await buildModelRuntime(config);
    app = buildApp({
      config,
      database,
      projectStore: projects,
      demoManagerStore: demos,
      demoManagerCoordinator: new DemoManagerCoordinator(demos),
      modelGateway: runtime.gateway,
      manager: runtime.manager
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  const createSource = async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        initial_message: "Подготовь план улучшения документации проекта",
        client_message_id: "manager-demo-source"
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ project: { id: string }; run_id: string }>();
  };

  it("persists a visible plan, bounded execution result, and checkpoint", async () => {
    const source = await createSource();
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs`,
      payload: {
        source_run_id: source.run_id,
        owner_goal: "Подготовь план улучшения документации проекта"
      }
    });

    expect(create.statusCode).toBe(201);
    const queued = create.json<{
      demo_run_id: string;
      status: string;
      graph: { nodes: unknown[] };
    }>();
    expect(queued.status).toBe("queued");
    expect(queued.graph.nodes).toHaveLength(3);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs`
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs/${queued.demo_run_id}/execute`
    });
    expect(execute.statusCode).toBe(200);
    const completed = execute.json<{
      status: string;
      artifacts: Array<{ kind: string; content: string }>;
    }>();
    expect(completed.status).toBe("succeeded");
    expect(completed.artifacts.map((artifact) => artifact.kind)).toEqual([
      "plan",
      "analysis",
      "handoff"
    ]);
    expect(completed.artifacts[1]?.content).toContain("synthetic/read-only");

    const restored = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs/${queued.demo_run_id}`
    });
    expect(restored.statusCode).toBe(200);
    expect(
      restored.json<{ checkpoint: { restores_permissions: boolean } }>().checkpoint
    ).toMatchObject({ restores_permissions: false });
  });

  it("keeps cancellation explicit and does not execute a cancelled plan", async () => {
    const source = await createSource();
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs`,
      payload: { source_run_id: source.run_id, owner_goal: "Проверь read-only контекст" }
    });
    const queued = create.json<{ demo_run_id: string }>();

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs/${queued.demo_run_id}/cancel`
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe("cancelled");

    const execute = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${source.project.id}/manager-demo-runs/${queued.demo_run_id}/execute`
    });
    expect(execute.statusCode).toBe(409);
    expect(demos.listArtifacts(queued.demo_run_id)).toEqual([]);
  });
});
