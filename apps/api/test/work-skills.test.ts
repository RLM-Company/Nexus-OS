import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  ManagerWorkStore,
  OwnerSkillStore,
  PolicyStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import type { CreateManagerWork, ChatSkillReference } from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { WorkPrivacyAdapter } from "../src/account-settings/privacy/integrated-adapters.js";
import { OwnerSkillPrivacyAdapter } from "../src/owner-skill-privacy.js";

describe("project Work Skills admission and API", () => {
  const owner = "local-owner";
  let db: ReturnType<typeof openDatabase>,
    store: ManagerWorkStore,
    catalog: OwnerSkillStore,
    projects: ProjectStore,
    project: string,
    app: ReturnType<typeof buildApp>,
    coordinator: ManagerWorkCoordinator;
  const input = (key: string = randomUUID()): CreateManagerWork => ({
    client_request_id: key,
    goal: "Create brief.md",
    worker_role: "analyst",
    max_model_requests: 3,
    max_input_tokens: 32000,
    max_output_tokens: 6000
  });
  const draft = (instructions = "PINNED_V1") => ({
    name: "Research",
    summary: "Sources",
    instructions
  });
  const put = (items: ChatSkillReference[], expected_version = 0, id = project) =>
    app.inject({
      method: "PUT",
      url: `/api/v1/projects/${id}/work-skills`,
      payload: { items, expected_version }
    });
  const accept = (key?: string) => store.create(project, owner, owner, input(key))!;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    projects = new ProjectStore(db.sqlite);
    store = new ManagerWorkStore(db.sqlite);
    catalog = new OwnerSkillStore(db.sqlite);
    project = projects.createProject("Work Skills", "source").project.id;
    const config = loadServerConfig({ NODE_ENV: "test" }),
      runtime = await buildModelRuntime(config),
      account = new AccountStore(db.sqlite);
    account.migrate();
    coordinator = new ManagerWorkCoordinator({
      store,
      projects,
      policy: new PolicyStore(db.sqlite),
      emergency: new EmergencyStopStore(db.sqlite),
      gateway: runtime.gateway,
      manager: runtime.manager,
      ownerBudget: account
    });
    app = buildApp({
      config,
      database: db,
      projectStore: projects,
      managerWorkStore: store,
      managerWorkCoordinator: coordinator
    });
  });
  afterEach(async () => {
    await app.close();
    await coordinator.stop();
    db.close();
  });
  it("pins, explicitly upgrades, disables and rejects stale/foreign/version-missing selections", async () => {
    const skill = catalog.create(owner, draft()),
      other = catalog.create("foreign", draft());
    expect((await put([{ skill_id: other.id, version: 1 }])).statusCode).toBe(404);
    expect((await put([{ skill_id: skill.id, version: 9 }])).statusCode).toBe(404);
    const response = await put([{ skill_id: skill.id, version: 1 }]);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    catalog.update(owner, skill.id, 1, draft("V2"));
    const a = accept();
    expect(store.skills.forWork(a.id, owner)?.items[0]?.instructions).toBe("PINNED_V1");
    expect((await put([], 0)).statusCode).toBe(409);
    expect((await put([{ skill_id: skill.id, version: 2 }], 1)).statusCode).toBe(200);
    expect(store.skills.forWork(accept().id, owner)?.items[0]?.instructions).toBe("V2");
    expect(store.skills.forWork(a.id, owner)?.items[0]?.instructions).toBe("PINNED_V1");
    expect((await put([], 2)).statusCode).toBe(200);
    expect(store.skills.forWork(accept().id, owner)?.items).toEqual([]);
    const wrong = projects.createProject("Other", "other-source").project.id;
    expect(
      (await app.inject({ url: `/api/v1/projects/${wrong}/work/${a.id}/skills` })).statusCode
    ).toBe(404);
    expect(store.skills.forWork(a.id, "foreign")).toBeNull();
    expect((await put([], 0, "unknown")).statusCode).toBe(404);
  });
  it.each([
    { items: [], expected_version: "0" },
    { items: [], expected_version: -1 },
    { items: [], expected_version: 0, owner_id: "foreign" },
    { items: [{ skill_id: "a", version: 0 }], expected_version: 0 },
    { items: [{ skill_id: "a", version: 1, permissions: ["all"] }], expected_version: 0 },
    {
      items: Array.from({ length: 4 }, (_, i) => ({ skill_id: String(i), version: 1 })),
      expected_version: 0
    }
  ])("rejects malformed bodies without coercion or mutation (%#)", async (payload) => {
    const r = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project}/work-skills`,
      payload
    });
    expect(r.statusCode, r.body).toBe(400);
    expect(store.skills.get(project, owner).version).toBe(0);
  });
  it("bounds UTF-8 input, duplicate Skills, and rolls back admission if snapshot insertion fails", async () => {
    const small = catalog.create(owner, draft()),
      huge = catalog.create(owner, draft("я".repeat(9000)));
    expect((await put([{ skill_id: small.id, version: 1 }])).statusCode).toBe(200);
    expect((await put([{ skill_id: huge.id, version: 1 }], 1)).statusCode).toBe(400);
    expect(
      (
        await put(
          [
            { skill_id: small.id, version: 1 },
            { skill_id: small.id, version: 1 }
          ],
          1
        )
      ).statusCode
    ).toBe(400);
    expect(store.skills.get(project, owner).version).toBe(1);
    db.sqlite.exec(
      "CREATE TRIGGER reject_work_skill BEFORE INSERT ON manager_work_skill_snapshots BEGIN SELECT RAISE(ABORT,'TEST_SNAPSHOT_FAILURE'); END"
    );
    expect(() => accept()).toThrow("TEST_SNAPSHOT_FAILURE");
    expect(store.list(project, owner)).toEqual([]);
    expect(db.sqlite.prepare("SELECT * FROM work_checkpoints").all()).toEqual([]);
  });
  it("retains idempotent snapshots through catalog deletion; database prevents cross-owner refs and snapshot updates", async () => {
    const skill = catalog.create(owner, draft());
    await put([{ skill_id: skill.id, version: 1 }]);
    const a = accept("stable"),
      before = store.skills.forWork(a.id, owner);
    catalog.delete(owner, skill.id, 1);
    expect(store.skills.get(project, owner)).toMatchObject({ version: 2, items: [] });
    expect(accept("stable").id).toBe(a.id);
    expect(store.skills.forWork(a.id, owner)).toEqual(before);
    expect(() =>
      db.sqlite
        .prepare("UPDATE manager_work_skill_snapshots SET skills_json='[]' WHERE work_id=?")
        .run(a.id)
    ).toThrow("SKILL_SNAPSHOT_IMMUTABLE");
    const foreign = catalog.create("foreign", draft());
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO work_skill_selections VALUES(?,?,1,0)")
        .run(project, foreign.id)
    ).toThrow("SKILL_OWNER_MISMATCH");
    const response = await app.inject({ url: `/api/v1/projects/${project}/work/${a.id}/skills` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ snapshot: before });
  });
  it("exports all snapshots, fences writes, and cascades deletion with either catalog adapter order", async () => {
    const skill = catalog.create(owner, draft());
    await put([{ skill_id: skill.id, version: 1 }]);
    const a = accept(),
      plan = store.dag.create(project, owner, owner, {
        client_request_id: "graph",
        title: "Plan",
        nodes: [{ id: "a", title: "A", goal: "File", depends_on: [] }]
      });
    const adapter = new WorkPrivacyAdapter(db.sqlite, coordinator);
    const exported = await adapter.export(owner);
    expect(exported.records.work_skills).toEqual(
      expect.arrayContaining([expect.objectContaining({ work_id: a.id })])
    );
    expect(exported.records.plan_skills).toEqual(
      expect.arrayContaining([expect.objectContaining({ graph_id: plan.id })])
    );
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test','at','at')"
      )
      .run(owner);
    expect((await put([], 1)).statusCode).toBe(409);
    expect(() => accept()).toThrow("OWNER_DATA_FENCED");
    await new OwnerSkillPrivacyAdapter(db.sqlite).delete(owner, 1);
    expect(store.skills.forWork(a.id, owner)?.items[0]?.instructions).toBe("PINNED_V1");
    await adapter.delete(owner, 1);
    for (const t of [
      "work_skill_settings",
      "work_skill_selections",
      "manager_work_skill_snapshots",
      "work_dag_skill_snapshots"
    ])
      expect(db.sqlite.prepare(`SELECT * FROM ${t}`).all()).toEqual([]);
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
