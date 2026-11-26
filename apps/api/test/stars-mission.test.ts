import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { openDatabase, runMigrations, StarsMissionStore } from "@cosmora/db";
import { expect, it } from "vitest";
import { registerStarsMissionRoutes } from "../src/stars-mission-routes.js";

const identity = (owner: string) => () => ({
  owner_id: owner,
  actor_id: owner,
  actor_kind: "owner" as const,
  session_id: owner,
  assurance: "local" as const,
  authenticated_at: new Date().toISOString(),
  expires_at: new Date().toISOString()
});

it("runs a Stars mission through failure, replacement, verification and combined result", async () => {
  const app = Fastify();
  const db = openDatabase(":memory:");
  try {
    await runMigrations(db);
    registerStarsMissionRoutes({
      app,
      store: new StarsMissionStore(db.sqlite),
      identityFor: identity("owner-a")
    });
    const requestId = randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/stars/missions",
      payload: {
        client_request_id: requestId,
        team_scope: "team-stars",
        goal: "Сравнить предложения"
      }
    });
    expect(created.statusCode).toBe(200);
    const mission = created.json<{ id: string; version: number }>();
    const url = "/api/v1/stars/missions/" + mission.id + "/events";
    const send = async (body: Record<string, unknown>) => {
      const response = await app.inject({ method: "POST", url, payload: body });
      expect(response.statusCode).toBe(200);
      return response.json<{ version: number; stage: string }>();
    };

    let state = await send({
      type: "brief",
      goal: "Сравнить предложения",
      expected_version: mission.version
    });
    state = await send({
      type: "plan",
      agents: [
        { id: "manager", role: "manager", task: "контролировать", context_scopes: [] },
        { id: "a1", role: "executor", task: "извлечь", context_scopes: [] },
        { id: "a2", role: "executor", task: "сверить", context_scopes: [] }
      ],
      expected_version: state.version
    });
    expect(state.stage).toBe("working");
    state = await send({
      type: "fail",
      agent_id: "a1",
      reason: "PROVIDER_ERROR",
      expected_version: state.version
    });
    state = await send({
      type: "replace",
      failed_agent_id: "a1",
      replacement_id: "a1b",
      expected_version: state.version
    });
    state = await send({
      type: "result",
      agent_id: "a1b",
      summary: "извлечено",
      artifact_ref: "artifact-1",
      expected_version: state.version
    });
    state = await send({
      type: "result",
      agent_id: "a2",
      summary: "сверено",
      expected_version: state.version
    });
    state = await send({
      type: "verify",
      agent_id: "a1b",
      verdict: "verified",
      verified_by: "manager",
      expected_version: state.version
    });
    state = await send({
      type: "verify",
      agent_id: "a2",
      verdict: "verified",
      verified_by: "manager",
      expected_version: state.version
    });
    state = await send({
      type: "combine",
      summary: "общий итог",
      expected_version: state.version
    });
    expect(state.stage).toBe("completed");

    const stale = await app.inject({
      method: "POST",
      url,
      payload: { type: "pause", expected_version: state.version - 1 }
    });
    expect(stale.statusCode).toBe(409);

    const list = await app.inject({ method: "GET", url: "/api/v1/stars/missions" });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
  } finally {
    await app.close();
    db.sqlite.close();
  }
});
