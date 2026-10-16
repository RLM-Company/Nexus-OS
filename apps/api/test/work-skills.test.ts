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
import type {
  CreateManagerWork,
  ChatSkillReference,
  WorkDag,
  WorkPlanPackage
} from "@cosmora/contracts";
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
  const plan = () =>
    store.dag.create(project, owner, owner, {
      client_request_id: randomUUID(),
      title: "Source",
      nodes: [
        { id: "a", title: "A", goal: "Brief", depends_on: [], requires_critic: true },
        { id: "b", title: "B", goal: "Document", depends_on: ["a"] }
      ]
    });
  const clone = (
    id: string,
    version: number,
    extra: Record<string, unknown> = {},
    sourceProject = project
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/projects/${sourceProject}/work-dags/${id}/clone`,
      payload: {
        client_request_id: "clone",
        expected_version: version,
        title: "Independent copy",
        skills: "source",
        ...extra
      }
    });
  it("copies only tasks/dependencies into an independent dormant plan and selects source or target Skills explicitly", async () => {
    const skill = catalog.create(owner, draft());
    await put([{ skill_id: skill.id, version: 1 }]);
    const source = plan();
    const finished = store.dag.save(
      {
        ...source,
        nodes: source.nodes.map((n) => ({
          ...n,
          status: "completed" as const,
          attempts: [
            { number: 1, work_id: "previous-work", started_at: "at", source_artifact_ids: [] }
          ],
          result: {
            stage: "done",
            plan_summary: "old",
            plan_instructions: "old",
            review: { verdict: "PASS", reason: "old" },
            confirmation_id: "old-permission",
            sources: []
          }
        })),
        execution: { status: "completed", max_model_requests: 6, reason: null, started_at: "at" },
        usage: { model_requests: 6, reserved_input_tokens: 1000, reserved_output_tokens: 300 }
      },
      "done"
    );
    catalog.delete(owner, skill.id, 1);
    const response = await clone(source.id, finished.version);
    expect(response.statusCode, response.body).toBe(201);
    const copied = response.json<WorkDag>();
    expect(copied.id).not.toBe(source.id);
    expect(copied.version).toBe(1);
    expect(copied.execution).toBeUndefined();
    expect(copied.usage).toBeUndefined();
    expect(copied.copied_from).toEqual({
      graph_id: source.id,
      version: finished.version,
      skills: "source"
    });
    expect(copied.nodes.map((n) => n.status)).toEqual(["pending", "blocked"]);
    expect(copied.nodes[1]!.depends_on).toEqual(["a"]);
    expect(copied.nodes.every((n) => !n.attempts.length && !n.artifacts.length && !n.result)).toBe(
      true
    );
    expect(copied.nodes[0]!.requires_critic).toBe(true);
    expect(store.skills.forPlan(copied.id, owner)).toMatchObject({
      source: "plan",
      source_id: source.id,
      items: [{ instructions: "PINNED_V1" }]
    });
    const target = projects.createProject("Target", randomUUID()).project.id;
    const fresh = catalog.create(owner, draft("TARGET_SKILL"));
    await put([{ skill_id: fresh.id, version: 1 }], 0, target);
    const different = await clone(source.id, finished.version, {
      target_project_id: target,
      skills: "project"
    });
    expect(different.statusCode, different.body).toBe(201);
    expect(
      store.skills.forPlan(different.json<{ id: string }>().id, owner)?.items[0]?.instructions
    ).toBe("TARGET_SKILL");
    expect(store.list(project, owner)).toEqual([]);
    expect(store.list(target, owner)).toEqual([]);
    expect(store.dag.get(source.id, owner)).toEqual(finished);
  });
  it("replays a lost clone acknowledgement even after source deletion and rejects changed content under the same key", async () => {
    const source = plan();
    const first = await clone(source.id, source.version);
    expect(first.statusCode).toBe(201);
    db.sqlite.prepare("DELETE FROM work_dags WHERE id=?").run(source.id);
    const replay = await clone(source.id, source.version);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect((await clone(source.id, source.version, { title: "Changed" })).statusCode).toBe(409);
    expect(store.dag.list(project, owner)).toHaveLength(1);
  });
  it("rejects stale sources, foreign projects/owners, inactive targets and fenced admissions without creating copies", async () => {
    const source = plan(),
      foreign = projects.createProject("Foreign", randomUUID(), "foreign").project.id;
    expect((await clone(source.id, 9)).statusCode).toBe(409);
    expect(
      (await clone(source.id, source.version, { target_project_id: foreign })).statusCode
    ).toBe(404);
    expect((await clone(source.id, source.version, {}, foreign)).statusCode).toBe(404);
    const other = store.dag.create(foreign, "foreign", "foreign", {
      client_request_id: "p",
      title: "Foreign",
      nodes: [{ id: "x", title: "X", goal: "x", depends_on: [] }]
    });
    expect((await clone(other.id, 1)).statusCode).toBe(404);
    db.sqlite.prepare("INSERT INTO work_owner_fences VALUES(?,1,1)").run(owner);
    expect((await clone(source.id, source.version)).statusCode).toBe(409);
    expect(store.dag.list(project, owner)).toHaveLength(1);
  });
  it.each([
    { skills: "auto" },
    { expected_version: "1" },
    { expected_version: 0 },
    { title: " " },
    { permissions: ["all"] },
    { owner_id: "foreign" }
  ])("rejects malformed clone bodies (%#)", async (extra) => {
    const source = plan();
    expect((await clone(source.id, source.version, extra)).statusCode).toBe(400);
    expect(store.dag.list(project, owner)).toHaveLength(1);
  });
  it("rolls back a clone if snapshot insertion fails and never inherits project cancellation", async () => {
    const source = plan(),
      target = projects.createProject("Target", randomUUID()).project.id;
    store.dag.setProjectMode(project, owner, "cancelled");
    expect((await clone(source.id, source.version)).statusCode).toBe(409);
    db.sqlite.exec(
      "CREATE TRIGGER reject_plan_skill BEFORE INSERT ON work_dag_skill_snapshots BEGIN SELECT RAISE(ABORT,'TEST_SNAPSHOT_FAILURE'); END"
    );
    const failed = await clone(source.id, source.version, { target_project_id: target });
    expect(failed.statusCode).toBe(500);
    expect(store.dag.list(target, owner)).toEqual([]);
    db.sqlite.exec("DROP TRIGGER reject_plan_skill");
    const copied = await clone(source.id, source.version, { target_project_id: target });
    expect(copied.statusCode).toBe(201);
    expect(copied.json<{ mode: string }>().mode).toBe("active");
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("exports a portable plan and idempotently imports a fresh copy with current project Skills and no execution", async () => {
    const source = plan();
    const skill = catalog.create(owner, draft("CURRENT_IMPORT_SKILL"));
    await put([{ skill_id: skill.id, version: 1 }]);
    const response = await app.inject({
      url: `/api/v1/projects/${project}/work-dags/${source.id}/package`
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-disposition"]).toContain("work-plan.json");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const pkg = response.json<WorkPlanPackage>();
    expect(Object.keys(pkg).sort()).toEqual(["format", "nodes", "title"]);
    const payload = { client_request_id: "import", package: pkg };
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project}/work-dags/import`,
      payload
    });
    expect(first.statusCode, first.body).toBe(201);
    const copy = first.json<WorkDag>();
    expect(copy.id).not.toBe(source.id);
    expect(copy.nodes.every((n) => n.attempts.length === 0 && n.artifacts.length === 0)).toBe(true);
    expect(copy.execution).toBeUndefined();
    expect(copy.usage).toBeUndefined();
    expect(store.skills.forPlan(copy.id, owner)?.items[0]?.instructions).toBe(
      "CURRENT_IMPORT_SKILL"
    );
    catalog.delete(owner, skill.id, 1);
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project}/work-dags/import`,
      payload
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(copy);
    expect(store.skills.forPlan(copy.id, owner)?.items[0]?.instructions).toBe(
      "CURRENT_IMPORT_SKILL"
    );
    expect(store.list(project, owner)).toEqual([]);
    const changed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project}/work-dags/import`,
      payload: { ...payload, package: { ...pkg, title: "Changed" } }
    });
    expect(changed.statusCode).toBe(409);
    const other = projects.createProject("Other", randomUUID()).project.id;
    expect(
      (await app.inject({ url: `/api/v1/projects/${other}/work-dags/${source.id}/package` }))
        .statusCode
    ).toBe(404);
  });
  it("rejects invalid import authority, graph structure, owners, oversized transport and privacy fences", async () => {
    const source = plan(),
      pkg = {
        format: "kosmora.work-plan.v1",
        title: "Import",
        nodes: source.nodes.map(({ id, title, goal, depends_on }) => ({
          id,
          title,
          goal,
          depends_on
        }))
      };
    const post = (value: unknown, id = project) =>
      app.inject({
        method: "POST",
        url: `/api/v1/projects/${id}/work-dags/import`,
        payload: { client_request_id: "import", package: value }
      });
    expect((await post({ ...pkg, owner_id: "foreign" })).statusCode).toBe(400);
    expect((await post({ ...pkg, skills: [{ instructions: "inject" }] })).statusCode).toBe(400);
    expect(
      (await post({ ...pkg, nodes: [{ ...pkg.nodes[0], depends_on: ["a"] }] })).statusCode
    ).toBe(400);
    expect(
      (await post({ ...pkg, nodes: [{ ...pkg.nodes[0], depends_on: ["missing"] }] })).statusCode
    ).toBe(400);
    expect((await post({ ...pkg, title: "x".repeat(650_000) })).statusCode).toBe(413);
    const foreign = projects.createProject("Foreign", randomUUID(), "foreign").project.id;
    expect((await post(pkg, foreign)).statusCode).toBe(404);
    db.sqlite.prepare("INSERT INTO work_owner_fences VALUES(?,1,1)").run(owner);
    expect((await post(pkg)).statusCode).toBe(409);
    expect(store.dag.list(project, owner)).toHaveLength(1);
  });
});
