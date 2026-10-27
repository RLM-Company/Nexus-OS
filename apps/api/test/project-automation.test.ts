import { afterEach, beforeEach, expect, it } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import {
  IdentityStore,
  ManagerWorkStore,
  ProjectAutomationStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { knowledgeHash } from "@cosmora/core";
import type { WorkDag } from "@cosmora/contracts";
import { buildApp } from "../src/app.js";
import { BearerSessionIdentityResolver } from "../src/identity.js";
import { ProjectAutomationPrivacy } from "../src/project-automation-privacy.js";
let db: ReturnType<typeof openDatabase>,
  app: ReturnType<typeof buildApp>,
  store: ProjectAutomationStore,
  work: ManagerWorkStore;
let headers: { authorization: string }, other: { authorization: string };
const base = "/api/v1/projects/p/automation";
const scope = { owner: "owner-a", project: "p" };
const definition = {
  title_template: "Report {{topic}}",
  variables: [{ key: "topic", label: "Topic", required: true }],
  nodes: [
    { id: "research", title: "Research {{topic}}", goal: "Study {{topic}}", depends_on: [] },
    {
      id: "review",
      title: "Review",
      goal: "Check research",
      depends_on: ["research"],
      requires_critic: true
    }
  ]
};
let clock: string;
type TestResponse = {
  id: string;
  version: number;
  body: Record<string, unknown>;
  mission: WorkDag;
  items: TestResponse[];
  attachment: { content: string };
};
beforeEach(async () => {
  db = openDatabase(":memory:");
  await runMigrations(db);
  const projects = new ProjectStore(db.sqlite);
  projects.createEmptyProject("p", "Project", "owner-a", "ACTIVE");
  projects.createEmptyProject("p2", "Project", "owner-a", "ACTIVE");
  projects.createEmptyProject("foreign", "Foreign", "owner-b", "ACTIVE");
  const identities = new IdentityStore(db.sqlite);
  const session = (owner: string) => {
    identities.registerActor(owner, owner, "owner");
    return {
      authorization:
        "Bearer " +
        identities.issueSession({
          ownerId: owner,
          actorId: owner,
          assurance: "single_factor",
          ttlMs: 60000
        }).token
    };
  };
  headers = session("owner-a");
  other = session("owner-b");
  work = new ManagerWorkStore(db.sqlite);
  store = new ProjectAutomationStore(db.sqlite);
  clock = "2026-10-27T12:00:00.000Z";
  app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    projectStore: projects,
    managerWorkStore: work,
    projectAutomationStore: store,
    identityResolver: new BearerSessionIdentityResolver(identities),
    now: () => clock
  });
});
afterEach(async () => {
  await app.close();
  db.close();
});
const post = (path: string, payload: unknown, h = headers) =>
  app.inject({
    method: "POST",
    url: base + path,
    headers: h,
    payload: payload as Record<string, unknown>
  });
const get = (path: string, h = headers) =>
  app.inject({ method: "GET", url: base + path, headers: h });
const book = async () => {
  const r = await post("/playbooks", { client_request_id: "book1", title: "Report", definition });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: string; version: number }>();
};
const instantiate = (id: string, extra = {}) =>
  post(`/playbooks/${id}/instantiate`, {
    client_request_id: "run1",
    playbook_version: 1,
    variables: { topic: "Moon" },
    ...extra
  });
it("seeds five usable playbooks idempotently without overwriting owner versions or calling a model", async () => {
  const first = await post("/playbooks/seed", {});
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json<TestResponse>().items).toHaveLength(5);
  expect((await post("/playbooks/seed", {})).json<TestResponse>().items.map((i) => i.id)).toEqual(
    first.json<TestResponse>().items.map((i) => i.id)
  );
  expect(store.list(scope, "playbook_version")).toHaveLength(5);
  expect(work.dag.list("p", "owner-a")).toHaveLength(0);
});
it("creates a real Work DAG with dependencies and a pinned immutable playbook version, without dispatch", async () => {
  const b = await book();
  const run = await instantiate(b.id);
  expect(run.statusCode, run.body).toBe(201);
  const result = run.json<TestResponse>();
  expect(result).toMatchObject({
    model_dispatched: false,
    mission: { title: "Report Moon", version: 1 }
  });
  expect(result.mission.nodes[1]).toMatchObject({ status: "blocked", depends_on: ["research"] });
  expect(work.dag.get(result.mission.id, "owner-a")).toEqual(result.mission);
  expect((await get("/missions")).json<TestResponse>().items).toHaveLength(1);
  expect(db.sqlite.prepare("SELECT count(*) n FROM manager_work").get()).toMatchObject({ n: 0 });
});
it("replays exact instantiation, rejects changed input and preserves the snapshot after publishing", async () => {
  const b = await book(),
    first = await instantiate(b.id),
    id = first.json<TestResponse>().mission.id;
  const d = structuredClone(definition);
  d.nodes[0]!.goal = "Different {{topic}}";
  expect(
    (
      await post(`/playbooks/${b.id}/publish`, {
        expected_version: 1,
        title: "Changed",
        definition: d,
        changelog: "v2"
      })
    ).statusCode
  ).toBe(200);
  expect((await instantiate(b.id)).json<TestResponse>().mission.id).toBe(id);
  expect((await instantiate(b.id, { variables: { topic: "Mars" } })).statusCode).toBe(409);
  expect(
    (
      await instantiate(b.id, { client_request_id: "run2", playbook_version: 1 })
    ).json<TestResponse>().mission.nodes[0]!.goal
  ).toBe("Study Moon");
  expect(
    (
      await instantiate(b.id, { client_request_id: "run3", playbook_version: 2 })
    ).json<TestResponse>().mission.nodes[0]!.goal
  ).toBe("Different Moon");
});
it("rolls back DAG and playbook receipt together when a downstream SQLite write fails", async () => {
  const b = await book();
  db.sqlite.exec(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON kosmora_automation_records WHEN NEW.kind='instantiation' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END"
  );
  expect((await instantiate(b.id)).statusCode).toBe(500);
  expect(work.dag.list("p", "owner-a")).toHaveLength(0);
  expect(store.list(scope, "instantiation")).toHaveLength(0);
  db.sqlite.exec("DROP TRIGGER fail_receipt");
  expect((await instantiate(b.id)).statusCode).toBe(201);
});
it.each([
  "/status",
  "/missions",
  "/playbooks",
  "/playbook-versions",
  "/instantiations",
  "/schedules",
  "/occurrences",
  "/suites",
  "/evaluations",
  "/collections"
])("isolates %s by real owner and does not accept bearer-free requests", async (path) => {
  expect((await get(path, other)).statusCode).toBe(404);
  expect((await app.inject({ method: "GET", url: base + path })).statusCode).toBe(401);
});
it("isolates guessed IDs even between projects of the same owner", async () => {
  const b = await book();
  const r = await app.inject({
    method: "POST",
    url: `/api/v1/projects/p2/automation/playbooks/${b.id}/instantiate`,
    headers,
    payload: { client_request_id: "run1", playbook_version: 1, variables: { topic: "Moon" } }
  });
  expect(r.statusCode).toBe(404);
});
it.each(["owner_id", "principal", "tenant_id"])(
  "rejects caller supplied authority %s",
  async (field) => {
    expect(
      (
        await post("/playbooks", {
          client_request_id: "key",
          title: "Title",
          definition,
          [field]: "owner-b"
        })
      ).statusCode
    ).toBe(400);
  }
);
it("rejects stale writes, archives explicitly and does not bypass an archived book", async () => {
  const b = await book();
  const update = { expected_version: 1, title: "v2", definition, changelog: "Second" };
  expect((await post(`/playbooks/${b.id}/publish`, update)).statusCode).toBe(200);
  expect((await post(`/playbooks/${b.id}/publish`, update)).statusCode).toBe(409);
  expect(
    (await post(`/playbooks/${b.id}/archive`, { expected_version: 2, archived: true })).statusCode
  ).toBe(200);
  expect((await instantiate(b.id)).statusCode).toBe(409);
  expect(store.list(scope, "playbook_version")).toHaveLength(2);
});
it("coalesces missed intervals and materializes a due occurrence exactly once without starting a model", async () => {
  const b = await book();
  expect(
    (
      await post("/schedules", {
        client_request_id: "schedule1",
        playbook_id: b.id,
        playbook_version: 1,
        variables: { topic: "Moon" },
        due_at: "2026-10-27T11:00:00.000Z",
        interval_seconds: 60
      })
    ).statusCode
  ).toBe(201);
  const tick = await post("/tick", {});
  expect(tick.statusCode, tick.body).toBe(200);
  const occurrence = tick.json<TestResponse>().items[0]!;
  expect(occurrence.body).toMatchObject({ coalesced_intervals: 60, requires_owner_start: true });
  expect((await post("/tick", {})).json<TestResponse>().items).toHaveLength(0);
  const accepted = await post(`/occurrences/${occurrence.id}/accept`, {});
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(
    (await post(`/occurrences/${occurrence.id}/accept`, {})).json<TestResponse>().mission.id
  ).toBe(accepted.json<TestResponse>().mission.id);
  expect(
    accepted
      .json<TestResponse>()
      .mission.nodes.every((n: { attempts: unknown[] }) => !n.attempts.length)
  ).toBe(true);
});
it("pauses and resumes a one-shot schedule, rejecting normalized calendar dates", async () => {
  const b = await book();
  const input = {
    client_request_id: "schedule1",
    playbook_id: b.id,
    playbook_version: 1,
    variables: { topic: "Moon" },
    due_at: clock,
    interval_seconds: null
  };
  expect(
    (await post("/schedules", { ...input, due_at: "2026-02-30T12:00:00.000Z" })).statusCode
  ).toBe(400);
  const s = (await post("/schedules", input)).json<TestResponse>();
  expect(
    (await post(`/schedules/${s.id}/pause`, { expected_version: 1, paused: true })).statusCode
  ).toBe(200);
  expect((await post("/tick", {})).json<TestResponse>().items).toHaveLength(0);
  expect(
    (await post(`/schedules/${s.id}/pause`, { expected_version: 2, paused: false })).statusCode
  ).toBe(200);
  expect((await post("/tick", {})).json<TestResponse>().items).toHaveLength(1);
  clock = "2026-10-28T12:00:00.000Z";
  expect((await post("/tick", {})).json<TestResponse>().items).toHaveLength(0);
});
it("stores exact evidence references and fails after the source is changed or is from another project", async () => {
  const note = work.memory.create("p", "owner-a", {
    title: "Source",
    content: "Moon base exact evidence",
    pinned: false,
    source: { kind: "owner", reference: "Owner" }
  })!;
  const refs = {
    kind: "memory",
    id: note.id,
    version: note.version,
    sha256: knowledgeHash(JSON.stringify([note.title, note.content, note.source])),
    start: 0,
    end: note.content.length,
    excerpt_sha256: knowledgeHash(note.content)
  };
  const created = await post("/collections", {
    client_request_id: "col1",
    title: "Moon",
    references: [refs]
  });
  expect(created.statusCode, created.body).toBe(201);
  const c = created.json<TestResponse>();
  const context = await post(`/collections/${c.id}/context`, {});
  expect(context.statusCode, context.body).toBe(200);
  expect(context.json<TestResponse>().attachment.content).toContain(note.content);
  expect(
    (
      await post("/collections", {
        client_request_id: "bad",
        title: "Wrong",
        references: [{ ...refs, id: "foreign" }]
      })
    ).statusCode
  ).toBe(404);
  db.sqlite.prepare("UPDATE project_memory SET version=version+1 WHERE id=?").run(note.id);
  expect((await post(`/collections/${c.id}/context`, {})).statusCode).toBe(409);
});
function completedWork(status = "completed") {
  const content = "Moon report verified",
    workId = "work1";
  db.sqlite
    .prepare("INSERT INTO manager_work VALUES (?,?,?,?,1,?)")
    .run(
      workId,
      "p",
      "owner-a",
      workId,
      JSON.stringify({ id: workId, project_id: "p", owner_id: "owner-a", status, version: 3 })
    );
  db.sqlite
    .prepare(
      "INSERT INTO work_artifact_versions(id,project_id,work_id,name,version,content,sha256,bytes,published,created_at) VALUES(?,?,?,?,1,?,?,?,?,?)"
    )
    .run(
      "file1",
      "p",
      workId,
      "report.md",
      content,
      knowledgeHash(content),
      Buffer.byteLength(content),
      1,
      clock
    );
}
it("evaluates only completed published saved artifacts, with immutable checksums and idempotent receipts", async () => {
  completedWork();
  const suite = await post("/suites", {
    client_request_id: "suite1",
    title: "Report checks",
    rules: [{ file: "report.md", kind: "contains", value: "Moon" }]
  });
  expect(suite.statusCode, suite.body).toBe(201);
  const first = await post(`/suites/${suite.json<TestResponse>().id}/evaluate`, {
    work_id: "work1",
    client_request_id: "eval1"
  });
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json<TestResponse>().body).toMatchObject({
    passed: true,
    model_quality_assessed: false,
    work_version: 3
  });
  expect(
    (
      await post(`/suites/${suite.json<TestResponse>().id}/evaluate`, {
        work_id: "work1",
        client_request_id: "eval1"
      })
    ).json<TestResponse>().id
  ).toBe(first.json<TestResponse>().id);
  expect(() =>
    db.sqlite
      .prepare("UPDATE kosmora_automation_records SET body_json='{}' WHERE id=?")
      .run(first.json<TestResponse>().id)
  ).toThrow("IMMUTABLE");
});
it("does not evaluate in-progress outputs or corrupted artifacts", async () => {
  completedWork("running");
  const suite = (
    await post("/suites", {
      client_request_id: "suite1",
      title: "Checks",
      rules: [{ file: "report.md", kind: "exists" }]
    })
  ).json<TestResponse>();
  expect(
    (await post(`/suites/${suite.id}/evaluate`, { work_id: "work1", client_request_id: "e1" }))
      .statusCode
  ).toBe(409);
  db.sqlite
    .prepare(
      "UPDATE manager_work SET state_json=json_set(state_json,'$.status','completed') WHERE id='work1'"
    )
    .run();
  db.sqlite
    .prepare("UPDATE work_artifact_versions SET sha256=? WHERE id='file1'")
    .run("0".repeat(64));
  expect(
    (await post(`/suites/${suite.id}/evaluate`, { work_id: "work1", client_request_id: "e1" }))
      .statusCode
  ).toBe(409);
});
it("uses durable global and Work fences, exports all records, deletes only one owner and retains no shadow worker", async () => {
  await book();
  const privacy = new ProjectAutomationPrivacy(db.sqlite);
  expect(() => privacy.export("owner-a")).toThrow("FENCE_REQUIRED");
  db.sqlite
    .prepare(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'quiescing','fixture',?,?)"
    )
    .run("owner-a", clock, clock);
  expect(
    (await post("/playbooks", { client_request_id: "book2", title: "Report", definition }))
      .statusCode
  ).toBe(423);
  expect(await privacy.quiesce("owner-a", 1)).toEqual({ drained: true, fence_epoch: 1 });
  expect((await privacy.export("owner-a")).records.automation).toHaveLength(2);
  db.sqlite
    .prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id='owner-a'")
    .run();
  expect(() => privacy.delete("owner-a", 2)).toThrow("FENCE_REQUIRED");
  expect(await privacy.delete("owner-a", 1)).toEqual({ deleted_records: 2 });
  expect(await privacy.delete("owner-a", 1)).toEqual({ deleted_records: 0 });
});
it("does not call the deprecated Gemini runtime when the real executor is absent", async () => {
  const b = await book(),
    mission = (await instantiate(b.id)).json<TestResponse>().mission;
  expect(
    (
      await post(`/missions/${mission.id}/control`, {
        version: 1,
        action: "run",
        node_id: "research"
      })
    ).statusCode
  ).toBe(503);
  expect(work.dag.get(mission.id, "owner-a")?.nodes[0]?.attempts).toHaveLength(0);
});
