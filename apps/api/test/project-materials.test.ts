import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  ProjectStore,
  ManagerWorkStore,
  openDatabase,
  runMigrations,
  type ProjectMaterials
} from "@cosmora/db";
import { ManagerService } from "@cosmora/core";
import { buildApp } from "../src/app.js";

describe("project materials", () => {
  let database: ReturnType<typeof openDatabase>;
  let store: ProjectStore;
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    store = new ProjectStore(database.sqlite);
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database,
      projectStore: store
    });
  });
  afterEach(async () => {
    await app.close();
    database.close();
  });
  it("persists context, rejects stale updates and binds a snapshot to new chat runs and Manager work", async () => {
    const first = store.createProject("Project", "material-project");
    const path = `/api/v1/projects/${first.project.id}/materials`;
    const initial = await app.inject({ method: "GET", url: path });
    expect(initial.json<ProjectMaterials>().version).toBe(0);
    const payload = {
      version: 0,
      instructions: "Пиши по-русски",
      attachments: [{ name: "brief.pdf", source_type: "pdf", content: "First version" }]
    };
    const saved = await app.inject({ method: "PUT", url: path, payload });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<ProjectMaterials>().version).toBe(1);
    expect((await app.inject({ method: "PUT", url: path, payload })).statusCode).toBe(409);
    const run = store.createMessage(first.project.id, "New task", "context-run")!;
    const snapshot = new ProjectStore(database.sqlite).getMaterialsForRun(run.run.id);
    expect(snapshot?.attachments[0]?.content).toBe("First version");
    expect(store.getMaterialsForRun(first.run.id)?.attachments).toEqual([]);
    const works = new ManagerWorkStore(database.sqlite);
    const work = works.create(first.project.id, "local-owner", "local-owner", {
      goal: "Make a useful file",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 30000,
      max_output_tokens: 3000,
      client_request_id: "materials-work"
    });
    expect(work?.materials?.attachments[0]?.content).toBe("First version");
    const changed = await app.inject({
      method: "PUT",
      url: path,
      payload: {
        ...payload,
        version: 1,
        attachments: [{ name: "brief.txt", content: "Second version" }]
      }
    });
    expect(changed.statusCode).toBe(200);
    expect(store.getMaterialsForRun(run.run.id)?.attachments[0]?.content).toBe("First version");
    expect(works.get(work!.id, "local-owner")?.materials?.attachments[0]?.content).toBe(
      "First version"
    );
    const manager = new ManagerService({
      preferredProvider: "mock",
      preferredModelAlias: "manager",
      fallbackAllowed: false
    });
    const request = manager.buildRequest({
      projectId: first.project.id,
      runId: run.run.id,
      messages: store.getConversationForRun(run.run.id),
      materials: snapshot
    });
    expect(request.messages[1]?.role).toBe("user");
    expect(request.messages[1]?.content).toContain("First version");
    expect(request.messages[1]?.content).not.toContain("Second version");
    expect(store.getMaterials(first.project.id, "another-owner")).toBeNull();
    expect(store.getMaterialsForRun(run.run.id, "another-owner")).toBeNull();
  });
  it("rejects oversized, binary and unsupported context before changing stored materials", async () => {
    const project = store.createProject("Project", "invalid-materials").project.id;
    for (const attachments of [
      [{ name: "brief.txt", content: "a\0b" }],
      [{ name: "script.exe", content: "hello" }],
      [{ name: "large.txt", content: "a".repeat(8001) }]
    ]) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/api/v1/projects/${project}/materials`,
            payload: { version: 0, instructions: "", attachments }
          })
        ).statusCode
      ).toBe(400);
    }
    expect(store.getMaterials(project)?.version).toBe(0);
  });
});
