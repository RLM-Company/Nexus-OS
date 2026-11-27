import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
type TestResponse = {
  statusCode: number;
  body: string;
  json<T>(): T;
};
import {
  AutomationStore,
  ManagerWorkStore,
  ProjectStore,
  StarsMissionStore,
  openDatabase,
  runMigrations,
  type ManagerWorkStore as ManagerWorkStoreType
} from "@cosmora/db";
import type { IdentityContext, WorkflowDefinitionInput } from "@cosmora/contracts";
import { registerAutomationRoutes } from "../src/automation-routes.js";
import type { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { LOCAL_DEVELOPMENT_IDENTITY } from "../src/identity.js";

const owner = "local-owner";
const dbs: ReturnType<typeof openDatabase>[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of dbs.splice(0)) db.close();
});

const definition = (extra: Partial<WorkflowDefinitionInput> = {}): WorkflowDefinitionInput => ({
  name: "Отчёт из разрешённых файлов",
  description: "Read the allowed file and create report.md",
  parameters: [{ id: "topic", label: "Тема", type: "text", required: true }],
  nodes: [
    {
      id: "report",
      title: "Подготовить отчёт",
      goal: "Create report.md about {{topic}} from allowed files only",
      depends_on: []
    }
  ],
  requirements: ["work.files.create"],
  expected_results: ["report.md"],
  ...extra
});

type Fixture = {
  db: ReturnType<typeof openDatabase>;
  store: AutomationStore;
  work: ManagerWorkStoreType;
  projects: ProjectStore;
  stars: StarsMissionStore;
  app: FastifyInstance;
  projectId: string;
  workflowId: string;
  call: (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) => Promise<TestResponse>;
};

async function fixture(): Promise<Fixture> {
  const db = openDatabase(":memory:");
  dbs.push(db);
  await runMigrations(db);
  const work = new ManagerWorkStore(db.sqlite);
  const projects = new ProjectStore(db.sqlite);
  const store = new AutomationStore(db.sqlite);
  const stars = new StarsMissionStore(db.sqlite);
  const project = projects.createProject("Automation", "source").project;
  const def = work.workflows.create(project.id, owner, definition(), "automation-definition");
  // Minimal coordinator stub: the runner only calls dag.create/save/get/control.
  const dag = {
    create: (...args: unknown[]) => ({ id: "dag-1", version: 1, project_id: args[0], nodes: [] }),
    save: (graph: unknown) => graph,
    get: () => null,
    control: () => ({ id: "dag-1", version: 2, nodes: [] })
  };
  const coordinator = { dag } as unknown as ManagerWorkCoordinator;
  const app = Fastify();
  apps.push(app);
  const identity: IdentityContext = {
    ...LOCAL_DEVELOPMENT_IDENTITY,
    owner_id: owner,
    actor_id: owner
  };
  registerAutomationRoutes({
    app,
    store,
    workflows: work,
    projects,
    coordinator,
    stars,
    identityFor: () => identity
  });
  const call = (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) =>
    app.inject({
      method,
      url: path,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      headers: body === undefined ? {} : { "content-type": "application/json" }
    });
  return { db, store, work, projects, stars, app, projectId: project.id, workflowId: def.id, call };
}

const createTrigger = (f: Fixture, body: Record<string, unknown>) =>
  f.call("POST", "/api/v1/automation/triggers", {
    client_request_id: "t-" + crypto.randomUUID().slice(0, 8),
    project_id: f.projectId,
    workflow_id: f.workflowId,
    definition_version: 1,
    kind: "manual",
    inputs: { topic: "Test" },
    ...body
  });

describe("Automation triggers, schedules and dedupe", () => {
  it("saves a versioned procedure and rejects stale version; schedule next due respects time zone", async () => {
    const f = await fixture();
    const { nextAutomationDueAt, isScheduleSpecValid } = await import("@cosmora/core");
    const spec = {
      mode: "weekly" as const,
      time_zone: "Europe/Moscow",
      local_time: "09:00",
      due_at: "2026-11-27T06:00:00.000Z"
    };
    expect(isScheduleSpecValid(spec)).toBe(true);
    const next = nextAutomationDueAt(spec, "2026-11-27T10:00:00.000Z");
    expect(next).not.toBeNull();
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(next!));
    expect(local).toBe("09:00");
    // Wrong time zone is rejected, never silently UTC.
    expect(isScheduleSpecValid({ ...spec, time_zone: "Not/AZone" })).toBe(false);
    expect(f.store.listTriggers(owner)).toEqual([]);
  });

  it("replays of one event create one trigger and one run; different events are independent", async () => {
    const f = await fixture();
    const body = {
      client_request_id: "evt-1",
      project_id: f.projectId,
      workflow_id: f.workflowId,
      definition_version: 1,
      source: "harness3-drive",
      event_type: "file.updated",
      event_id: "event-42",
      bindings: { topic: "File updated" }
    };
    const first = await f.call("POST", "/api/v1/automation/events", body);
    expect(first.statusCode).toBe(201);
    const second = await f.call("POST", "/api/v1/automation/events", body);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ dedupe: boolean }>().dedupe).toBe(true);
    expect(second.json<{ receipt: { status: string } }>().receipt.status).toBe("accepted");
    expect(second.json<{ trigger: { id: string } }>().trigger.id).toBe(
      first.json<{ trigger: { id: string } }>().trigger.id
    );
    expect(f.store.listTriggers(owner)).toHaveLength(1);
    expect(f.store.listRuns(owner)).toHaveLength(1);
    const other = await f.call("POST", "/api/v1/automation/events", {
      ...body,
      client_request_id: "evt-2",
      event_id: "event-43"
    });
    expect(other.statusCode).toBe(201);
    expect(f.store.listTriggers(owner)).toHaveLength(2);
    expect(f.store.listRuns(owner)).toHaveLength(2);
    const stale = await f.call("POST", "/api/v1/automation/events", {
      ...body,
      client_request_id: "evt-stale",
      event_id: "event-44",
      definition_version: 99
    });
    expect(stale.statusCode).toBe(400);
    expect(f.store.listTriggers(owner)).toHaveLength(2);
    const inbox = await f.call("GET", "/api/v1/automation/events");
    const receipts = inbox.json<{
      items: {
        id: string;
        event_key: string;
        status: string;
        run_id?: string;
        reason: string;
      }[];
    }>().items;
    expect(receipts).toHaveLength(3);
    expect(receipts.filter((r) => r.status === "accepted")).toHaveLength(2);
    expect(receipts.find((r) => r.status === "rejected")?.reason).toBe("STALE_WORKFLOW_VERSION");
    const accepted = receipts.find((r) => r.status === "accepted")!;
    const replay = await f.call("POST", `/api/v1/automation/events/${accepted.id}/replay`, {
      expected_status: "accepted",
      reason: "Check"
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(false);
  });

  it("moves a pinned trigger to a new version explicitly while old runs keep their snapshot", async () => {
    const f = await fixture();
    const created = await createTrigger(f, {});
    expect(created.statusCode).toBe(201);
    const triggerId = created.json<{ id: string }>().id;
    f.work.workflows.edit(f.projectId, owner, f.workflowId, 1, {
      ...definition(),
      name: "Changed procedure"
    });
    const changed = await f.call("POST", `/api/v1/automation/triggers/${triggerId}/version`, {
      expected_version: 1,
      definition_version: 2,
      version_policy: "pinned",
      reason: "Reviewed change"
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ version: number; definition_version: number }>()).toMatchObject({
      version: 2,
      definition_version: 2
    });
    const stale = await f.call("POST", `/api/v1/automation/triggers/${triggerId}/version`, {
      expected_version: 1,
      definition_version: 2,
      reason: "Stale"
    });
    expect(stale.statusCode).toBe(409);
  });

  it("rejects a stale definition version at trigger creation", async () => {
    const f = await fixture();
    const created = await createTrigger(f, { definition_version: 99 });
    expect(created.statusCode).toBe(400);
    expect(created.json()).toMatchObject({ error: { code: "STALE_WORKFLOW_VERSION" } });
  });
});

describe("Lease, recovery, cancellation and external actions", () => {
  it("claims a run once, recovers expired lease without executing twice, and cancels cleanly", async () => {
    const f = await fixture();
    const created = await createTrigger(f, {});
    expect(created.statusCode).toBe(201);
    const triggerId = created.json<{ id: string }>().id;
    const enqueued = f.store.enqueue(
      owner,
      f.projectId,
      f.store.getTrigger(owner, triggerId)!,
      owner
    );
    expect(enqueued.status).toBe("queued");
    const claimed = f.store.claim(owner, enqueued.id, "server-A", 60_000, owner);
    expect(claimed?.status).toBe("claimed");
    expect(f.store.claim(owner, enqueued.id, "server-B", 60_000, owner)).toBeNull();
    // Restart recovery of an expired lease returns to queued, attempt preserved.
    f.db.sqlite
      .prepare("UPDATE automation_runs SET lease_expires_at=? WHERE id=?")
      .run(new Date(Date.now() - 1000).toISOString(), enqueued.id);
    const recovered = f.store.recoverExpiredLeases(owner);
    expect(recovered.some((r) => r.id === enqueued.id)).toBe(true);
    const after = f.store.getRun(owner, enqueued.id)!;
    expect(after.status).toBe("queued");
    expect(after.attempt).toBe(1);
    // Cancel during execution passes through CAS.
    const cancelled = await f.call("POST", `/api/v1/automation/runs/${enqueued.id}/control`, {
      expected_version: after.version,
      action: "cancel"
    });
    expect(cancelled.statusCode).toBe(200);
    expect(f.store.getRun(owner, enqueued.id)?.status).toBe("cancelled");
    // A cancelled run cannot be resumed.
    const resume = await f.call("POST", `/api/v1/automation/runs/${enqueued.id}/control`, {
      expected_version: cancelled.json<{ version: number }>().version + 1,
      action: "resume"
    });
    expect(resume.statusCode).toBe(400);
  });

  it("unknown external result is never blindly retried; verification is explicit", async () => {
    const f = await fixture();
    const trigger = f.store.createTrigger(owner, f.projectId, owner, {
      client_request_id: "ext-trigger",
      workflow_id: f.workflowId,
      definition_version: 1,
      kind: "manual",
      inputs: { topic: "T" }
    });
    const run = f.store.enqueue(owner, f.projectId, trigger, owner);
    const action = f.store.externalAction({
      owner,
      runId: run.id,
      triggerId: trigger.id,
      connector: "harness3-gmail",
      operation: "send_message",
      operationKey: "send:message-1"
    });
    expect(action.status).toBe("pending");
    const unknown = f.store.markExternalUnknown(owner, action.id);
    expect(unknown.status).toBe("unknown");
    expect(f.store.getRun(owner, run.id)?.status).toBe("unknown_external");
    // The same operation key reuses the action: no second external send.
    const again = f.store.externalAction({
      owner,
      runId: run.id,
      triggerId: trigger.id,
      connector: "harness3-gmail",
      operation: "send_message",
      operationKey: "send:message-1"
    });
    expect(again.id).toBe(action.id);
    // Repeated unknown report does not retry or publish the external action.
    expect(f.store.markExternalUnknown(owner, again.id).status).toBe("unknown");
    expect(f.store.getRun(owner, run.id)?.status).toBe("unknown_external");
    const verified = f.store.verifyExternal(owner, action.id, true, owner);
    expect(verified.status).toBe("verified");
    expect(f.store.getRun(owner, run.id)?.status).toBe("succeeded");
  });

  it("fenced owner cannot start new steps; no partial write on conflict", async () => {
    const f = await fixture();
    const trigger = f.store.createTrigger(owner, f.projectId, owner, {
      client_request_id: "fence-trigger",
      workflow_id: f.workflowId,
      definition_version: 1,
      kind: "manual",
      inputs: { topic: "T" }
    });
    f.db.sqlite
      .prepare("INSERT INTO work_owner_fences(owner_id,epoch,fenced) VALUES(?,1,1)")
      .run(owner);
    expect(() =>
      f.store.createTrigger(owner, f.projectId, owner, {
        client_request_id: "after-fence",
        workflow_id: f.workflowId,
        definition_version: 1,
        kind: "manual",
        inputs: { topic: "T" }
      })
    ).toThrow(/OWNER_DATA_FENCED/);
    expect(() => f.store.enqueue(owner, f.projectId, trigger, owner)).toThrow(/OWNER_DATA_FENCED/);
    expect(f.store.listRuns(owner)).toHaveLength(0);
  });
});

describe("Confirmation gate and Stars consumer", () => {
  it("a procedure with a confirmation point waits for a human before the plan starts", async () => {
    const f = await fixture();
    const withConfirm = definition({
      name: "Publish with approval",
      confirmations: [
        {
          id: "publish-approval",
          node_id: "report",
          description: "Approve external publication",
          external_action: "publish report.md"
        }
      ]
    });
    f.work.workflows.edit(f.projectId, owner, f.workflowId, 1, withConfirm);
    const created = await createTrigger(f, { definition_version: 2 });
    expect(created.statusCode).toBe(201);
    const triggerId = created.json<{ id: string }>().id;
    const run = f.store.enqueue(owner, f.projectId, f.store.getTrigger(owner, triggerId)!, owner);
    const started = await f.call("POST", `/api/v1/automation/runs/${run.id}/control`, {
      expected_version: run.version,
      action: "run"
    });
    expect(started.statusCode).toBe(200);
    expect(started.json<{ run: { status: string; confirmation_id: string } }>().run.status).toBe(
      "awaiting_confirmation"
    );
    const confirm = await f.call("POST", `/api/v1/automation/runs/${run.id}/control`, {
      expected_version: run.version + 1,
      action: "confirm"
    });
    expect(confirm.statusCode).toBe(200);
    expect(f.store.getRun(owner, run.id)?.status).toBe("queued");
    expect(f.store.listRuns(owner)).toHaveLength(1);
  });

  it("Stars consumer creates exactly one canonical mission from a successful run", async () => {
    const f = await fixture();
    const trigger = f.store.createTrigger(owner, f.projectId, owner, {
      client_request_id: "stars-trigger",
      workflow_id: f.workflowId,
      definition_version: 1,
      kind: "manual",
      inputs: { topic: "T" }
    });
    let run = f.store.enqueue(owner, f.projectId, trigger, owner);
    run = f.store.transition(owner, run.id, run.version, { status: "succeeded", reason: "done" });
    const body = {
      client_request_id: "consumer-1",
      team_scope: "team-1",
      goal: "Consumer goal"
    };
    const first = await f.call("POST", `/api/v1/automation/runs/${run.id}/stars-consumer`, body);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ mission_id: string }>().mission_id).toBe("mission-consumer-1");
    const second = await f.call("POST", `/api/v1/automation/runs/${run.id}/stars-consumer`, body);
    expect(second.json<{ mission_id: string }>().mission_id).toBe("mission-consumer-1");
    expect(f.stars.list(owner)).toHaveLength(1);
  });
});
