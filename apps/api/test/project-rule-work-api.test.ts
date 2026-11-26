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
  authenticated_at: "2026-11-25T00:00:00.000Z"
} as IdentityContext;
// New comparable source data: different suppliers/prices/delivery from the first package.
const source = ["Поставщик;Цена;Доставка", "Север;250 ₽;5 дней", "Юг;220 ₽;11 дней"].join("\n");
const setup = async () => {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const project = new ProjectStore(db.sqlite).createProject("Rules Work", "rules-work", "owner")
    .project.id;
  const app = Fastify();
  apps.push(app);
  const store = new ProjectCorrectionRuleStore(db.sqlite);
  registerProjectCorrectionRuleRoutes({
    app,
    store,
    identityFor: () => identity,
    workResults: () => ({ files: [{ name: "comparison.txt", content: source }] })
  });
  return { project, app, store, base: `/api/v1/projects/${project}/correction-rules` };
};
const post = (app: FastifyInstance, url: string, body: unknown) =>
  app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
const apply = (app: FastifyInstance, base: string) =>
  post(app, `${base}/work-apply`, { dag_id: "dag-1", file_name: "comparison.txt" });

type ApplyResponse = {
  content: string;
  applied_rule_versions: Array<{ id: string; version: number; effect: string }>;
  conflicts: Array<{ ids: string[] }>;
  ignored_rules: string[];
  rule_statuses: Array<{ id: string; status: string }>;
};

describe("rules connected to an ordinary Koswork result", () => {
  it("keeps the exact accepted rule version through edit → confirm → next task → disable", async () => {
    const { app, base } = await setup();
    const before = (await apply(app, base)).json<ApplyResponse>();
    expect(before.content).toContain("Север: 250 ₽ (доставка 5 дней)");
    expect(before.applied_rule_versions).toEqual([]);

    const correction = "В сравнении поставщиков всегда показывай доставку отдельной строкой";
    const proposed = (await post(app, `${base}/propose`, { correction })).json<{
      draft: { instructions: string; accepted: boolean };
    }>();
    expect(proposed.draft.accepted).toBe(false);
    const accepted = (
      await post(app, `${base}/accept`, {
        client_request_id: "rule-work-1",
        correction
      })
    ).json<{ rule: { id: string; version: number } }>().rule;
    expect(accepted.version).toBe(1);

    const withRule = (await apply(app, base)).json<ApplyResponse>();
    expect(withRule.content).toContain("Доставка: 5 дней");
    expect(withRule.applied_rule_versions).toEqual([
      { id: accepted.id, version: 1, effect: "delivery_separate_line" }
    ]);

    // Next task with the SAME source data and the same rule still uses version 1.
    const nextTask = (await apply(app, base)).json<ApplyResponse>();
    expect(nextTask.applied_rule_versions[0]?.version).toBe(1);

    await post(app, `${base}/${accepted.id}/disable`, { expected_version: 1 });
    const disabled = (await apply(app, base)).json<ApplyResponse>();
    expect(disabled.content).toContain("Север: 250 ₽ (доставка 5 дней)");
    expect(disabled.applied_rule_versions).toEqual([]);
  });

  it("shows conflicts, unknown and inapplicable rules with clear statuses", async () => {
    const { app, base } = await setup();
    const conflictText = "В сравнении поставщиков всегда показывай доставку отдельной строкой";
    await post(app, `${base}/accept`, { client_request_id: "c1", correction: conflictText });
    await post(app, `${base}/accept`, { client_request_id: "c2", correction: conflictText });
    const conflict = (await apply(app, base)).json<ApplyResponse>();
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0]!.ids).toHaveLength(2);
    expect(conflict.rule_statuses.every((s) => s.status === "conflict")).toBe(true);

    const unknown = await setup();
    await post(unknown.app, `${unknown.base}/accept`, {
      client_request_id: "u1",
      correction: "Всегда раскрашивай отчёт в зелёный цвет"
    });
    const result = (await apply(unknown.app, unknown.base)).json<ApplyResponse>();
    expect(result.rule_statuses[0]?.status).toBe("ignored_unknown");
    expect(result.ignored_rules).toHaveLength(1);
    expect(result.content).toContain("Север: 250 ₽");
  });

  it("applies the agreed style scenario as a visible header with its version", async () => {
    const { app, base } = await setup();
    const accepted = (
      await post(app, `${base}/accept`, {
        client_request_id: "style-1",
        correction: "Оформи документ в стиле делового отчёта"
      })
    ).json<{ rule: { id: string; version: number } }>().rule;
    const result = (await apply(app, base)).json<ApplyResponse>();
    expect(result.content).toContain("Стиль: Правка владельца");
    expect(result.applied_rule_versions).toEqual([
      { id: accepted.id, version: 1, effect: "style_header" }
    ]);
  });
});
