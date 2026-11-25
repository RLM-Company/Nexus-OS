import type { IdentityContext } from "@cosmora/contracts";
import { openDatabase, ProjectCorrectionRuleStore, ProjectStore, runMigrations } from "@cosmora/db";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerProjectCorrectionRuleRoutes } from "../src/project-correction-rule-routes.js";

const apps: FastifyInstance[] = [];
const dbs: Array<ReturnType<typeof openDatabase>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});
const identity: IdentityContext = {
  owner_id: "owner",
  actor_id: "owner",
  actor_kind: "owner",
  assurance: "local",
  session_id: "test",
  authenticated_at: "2026-11-25T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z"
};
const setup = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const project = new ProjectStore(db.sqlite).createProject("Сравнение", "rules-http", "owner")
    .project.id;
  const app = Fastify();
  apps.push(app);
  registerProjectCorrectionRuleRoutes({
    app,
    store: new ProjectCorrectionRuleStore(db.sqlite),
    identityFor: () => identity
  });
  const base = `/api/v1/projects/${project}/correction-rules`;
  return { app, base };
};
const post = (app: FastifyInstance, url: string, body: unknown) =>
  app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });

describe("project correction rule HTTP flow", () => {
  it("proposes a draft, accepts it with the exact text, then disables by version", async () => {
    const { app, base } = await setup();
    const correction = "В сравнении поставщиков всегда показывай доставку отдельной строкой";
    const proposed = await post(app, `${base}/propose`, { correction });
    expect(proposed.statusCode).toBe(200);
    const draft = proposed.json<{ draft: { instructions: string; accepted: boolean } }>().draft;
    expect(draft.instructions).toContain(correction);
    expect(draft.accepted).toBe(false); // предложение инертно до подтверждения

    const accepted = await post(app, `${base}/accept`, {
      client_request_id: "rule-1",
      correction
    });
    expect(accepted.statusCode).toBe(201);
    const rule = accepted.json<{ rule: { id: string; version: number; enabled: boolean } }>().rule;
    expect(rule).toMatchObject({ version: 1, enabled: true });
    // Повтор того же client_request_id не создаёт вторую версию.
    const replay = await post(app, `${base}/accept`, { client_request_id: "rule-1", correction });
    expect(replay.json<{ rule: { id: string } }>().rule.id).toBe(rule.id);

    expect(
      (
        await post(app, `${base}/accept`, {
          client_request_id: "rule-1",
          correction: "Иное правило"
        })
      ).statusCode
    ).toBe(409);

    const listed = await app.inject({ method: "GET", url: base });
    expect(listed.json<{ rules: unknown[] }>().rules).toHaveLength(1);
    const disabled = await post(app, `${base}/${rule.id}/disable`, { expected_version: 1 });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json<{ rule: { enabled: boolean } }>().rule.enabled).toBe(false);
    const stale = await post(app, `${base}/${rule.id}/disable`, { expected_version: 1 });
    expect(stale.statusCode).toBe(409);
  });
});
