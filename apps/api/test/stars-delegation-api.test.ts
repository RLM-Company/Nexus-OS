import { randomUUID } from "node:crypto";
import type { IdentityContext } from "@cosmora/contracts";
import {
  openDatabase,
  ProjectStore,
  runMigrations,
  StarsMissionStore,
  StarsOrgStore,
  WorkDagStore
} from "@cosmora/db";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerStarsMissionRoutes } from "../src/stars-mission-routes.js";

const apps: FastifyInstance[] = [];
const dbs: Array<ReturnType<typeof openDatabase>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const identity: IdentityContext = {
  owner_id: "a",
  actor_id: "a",
  actor_kind: "owner",
  assurance: "local",
  session_id: "test",
  authenticated_at: "2026-11-27T00:00:00.000Z"
} as IdentityContext;
const setup = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const project = new ProjectStore(db.sqlite).createProject("stars", "stars-delegate", "a").project;
  const dagStore = new WorkDagStore(db.sqlite);
  const app = Fastify();
  apps.push(app);
  registerStarsMissionRoutes({
    app,
    store: new StarsMissionStore(db.sqlite),
    projects: new ProjectStore(db.sqlite),
    orgStore: new StarsOrgStore(db.sqlite),
    dag: {
      create: (owner: string, _actor: string, _owner: string, input: never) =>
        dagStore.create(project.id, owner, owner, input),
      get: (id: string, owner: string) => dagStore.get(id, owner)
    } as never,
    identityFor: () => identity
  });
  const at = "2026-11-27T10:00:00.000Z";
  const node = (
    id: string,
    role: string,
    manager_id: string | null,
    zones: string[],
    projects: string[]
  ) => ({
    id,
    role,
    manager_id,
    responsibility_zones: zones,
    project_ids: projects,
    status: "active",
    effective_from: at
  });
  new StarsOrgStore(db.sqlite).save(
    {
      team_scope: "team-1",
      version: 1,
      nodes: [
        node("chief", "chief", null, ["*"], [project.id]),
        node("sub1", "submanager", "chief", ["research"], [project.id]),
        node("a1", "executor", "sub1", ["research"], [])
      ],
      checksum: "c".repeat(64)
    } as never,
    "a",
    0
  );
  return { app, project };
};
const post = (app: FastifyInstance, url: string, body: unknown) =>
  app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });

describe("Stars delegation into real WorkDAG store", () => {
  it("creates a persisted DAG with dependency and records composition/mission versions", async () => {
    const { app, project } = await setup();
    const created = await post(app, "/api/v1/stars/missions", {
      client_request_id: randomUUID(),
      team_scope: "team-1",
      goal: "Сравнить поставщиков"
    });
    expect(created.statusCode).toBe(200);
    const mission = created.json<{ id: string; version: number }>();
    const events = `${"/api/v1/stars/missions"}/${mission.id}/events`;
    let state = (
      await post(app, events, {
        type: "brief",
        goal: "Сравнить поставщиков",
        author: "owner",
        responsible: "sub1",
        input_versions: ["materials@4"],
        criteria: ["доставка отдельной строкой"],
        acceptance_rules: ["проверка старшим"],
        expected_version: mission.version
      })
    ).json<{ version: number; stage: string }>();
    state = (
      await post(app, events, {
        type: "plan",
        agents: [
          { id: "chief", role: "manager", task: "координировать", context_scopes: [] },
          { id: "a1", role: "executor", task: "извлечь", context_scopes: [] },
          { id: "a2", role: "executor", task: "сверить", context_scopes: [] }
        ],
        dependencies: {},
        expected_version: state.version
      })
    ).json<{ version: number; stage: string }>();
    expect(state.stage).toBe("working");

    const delegated = await post(app, `/api/v1/stars/missions/${mission.id}/delegation`, {
      project_id: project.id,
      zones: { a1: "research" }
    });
    expect(delegated.statusCode, delegated.body).toBe(200);
    const body = delegated.json<{
      graph: { id: string; nodes: Array<{ id: string; depends_on: string[]; goal: string }> };
      delegation: { graph_id: string; composition_version: number; mission_version: number };
    }>();
    expect(body.graph.nodes).toHaveLength(1);
    expect(body.graph.nodes[0]!.id).toBe("a1");
    expect(body.graph.nodes[0]!.goal).toContain("materials@4");
    expect(body.delegation.composition_version).toBe(1);

    // Idempotent replay: same versions do not create a second DAG.
    const replay = await post(app, `/api/v1/stars/missions/${mission.id}/delegation`, {
      project_id: project.id,
      zones: { a1: "research" }
    });
    expect(replay.json<{ graph: { id: string } }>().graph.id).toBe(body.graph.id);
  }, 60_000);
});
