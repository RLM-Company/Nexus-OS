import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  openDatabase,
  runMigrations,
  ProjectStore,
  ManagerWorkStore,
  ProjectAutomationStore,
  IdentityStore,
  PayStore
} from "../packages/db/dist/index.js";
import { loadServerConfig } from "../packages/config/dist/index.js";
import { buildApp } from "../apps/api/dist/app.js";
import { BearerSessionIdentityResolver } from "../apps/api/dist/identity.js";
import { ProjectAutomationPrivacy } from "../apps/api/dist/project-automation-privacy.js";

/** Memory-only or copied-database acceptance. Never pass the live production handle. No provider transport exists here. */
export async function automationPreflight(db) {
  const owner = "automation-release-fixture",
    project = "automation-release-fixture";
  const projects = new ProjectStore(db.sqlite),
    identities = new IdentityStore(db.sqlite),
    work = new ManagerWorkStore(db.sqlite);
  projects.createEmptyProject(project, "Isolated release rehearsal", owner, "ACTIVE");
  identities.registerActor(owner, owner, "owner");
  identities.registerActor(owner, owner + "-agent", "agent");
  const issued = identities.issueSession({
    ownerId: owner,
    actorId: owner,
    assurance: "multi_factor",
    ttlMs: 60000
  });
  const agent = identities.issueSession({
    ownerId: owner,
    actorId: owner + "-agent",
    assurance: "single_factor",
    ttlMs: 60000
  });
  const headers = { authorization: "Bearer " + issued.token };
  const app = buildApp({
    config: loadServerConfig({ NODE_ENV: "test" }),
    database: db,
    projectStore: projects,
    managerWorkStore: work,
    projectAutomationStore: new ProjectAutomationStore(db.sqlite),
    identityStore: identities,
    payStore: new PayStore(db.sqlite),
    identityResolver: new BearerSessionIdentityResolver(identities)
  });
  const base = "/api/v1/projects/" + project + "/automation";
  const post = (path, payload) =>
    app.inject({ method: "POST", url: base + path, headers, payload });
  try {
    assert.equal((await app.inject({ method: "GET", url: base + "/status" })).statusCode, 401);
    const seed = await post("/playbooks/seed", {});
    assert.equal(seed.statusCode, 200, seed.body);
    assert.equal(seed.json().items.length, 5);
    const id = seed.json().items[0].id;
    const input = {
      client_request_id: "fixture-run",
      playbook_version: 1,
      variables: { topic: "Exact release fixture" }
    };
    const first = await post("/playbooks/" + id + "/instantiate", input);
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().model_dispatched, false);
    assert.equal(first.json().mission.nodes.length, 3);
    const replay = await post("/playbooks/" + id + "/instantiate", input);
    assert.equal(replay.json().mission.id, first.json().mission.id);
    assert.equal(
      (
        await post("/playbooks/" + id + "/instantiate", {
          ...input,
          variables: { topic: "Different" }
        })
      ).statusCode,
      409
    );
    const schedule = await post("/schedules", {
      client_request_id: "fixture-schedule",
      playbook_id: id,
      playbook_version: 1,
      variables: { topic: "Due fixture" },
      due_at: new Date(Date.now() - 60_000).toISOString(),
      interval_seconds: null
    });
    assert.equal(schedule.statusCode, 201, schedule.body);
    const due = await post("/tick", {});
    assert.equal(due.statusCode, 200, due.body);
    assert.equal(due.json().items.length, 1);
    assert.equal((await post("/tick", {})).json().items.length, 0);
    const accepted = await post("/occurrences/" + due.json().items[0].id + "/accept", {});
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().mission.nodes.flatMap((n) => n.attempts).length, 0);
    work.memory.create(project, owner, {
      title: "Release evidence",
      content: "Exact compiled fixture evidence",
      pinned: false,
      source: { kind: "owner", reference: "Fixture" }
    });
    const found = await app.inject({
      method: "POST",
      url: "/api/v1/projects/" + project + "/knowledge/search",
      headers,
      payload: { query: "fixture", kinds: ["memory"] }
    });
    assert.equal(found.statusCode, 200, found.body);
    const collection = await post("/collections", {
      client_request_id: "fixture-collection",
      title: "Exact evidence",
      references: [found.json().hits[0].reference]
    });
    assert.equal(collection.statusCode, 201, collection.body);
    const context = await post("/collections/" + collection.json().id + "/context", {});
    assert.equal(context.statusCode, 200, context.body);
    assert.ok(context.json().attachment.content.includes("Exact compiled fixture evidence"));
    assert.equal(
      (
        await post("/suites", {
          client_request_id: "fixture-suite",
          title: "Saved artifact checks",
          rules: [{ file: "result.md", kind: "exists" }]
        })
      ).statusCode,
      201
    );
    const pay = await app.inject({ method: "GET", url: "/api/v1/pay/status", headers });
    assert.equal(pay.statusCode, 200);
    assert.equal(pay.json().checkout_enabled, false);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/pay/checkout",
          headers: { ...headers, "idempotency-key": "fixture-checkout-key" },
          payload: { customer_ref: "fixture", plan_code: "fixture" }
        })
      ).statusCode,
      503
    );
    assert.equal(new PayStore(db.sqlite).summary(owner).orders_total, 0);
    for (const action of ["suspend", "restore"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/identity/actors/" + owner + "-agent/" + action,
        headers,
        payload: { reason: "Isolated compiled acceptance" }
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.equal(identities.resolveSession(agent.token), null);
    assert.equal(identities.listActorModerations(owner).length, 2);
    assert.equal(
      db.sqlite.prepare("SELECT count(*) n FROM manager_work WHERE owner_id=?").get(owner).n,
      0
    );
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'quiescing','fixture',?,?)"
      )
      .run(owner, at, at);
    assert.equal((await post("/tick", {})).statusCode, 423);
    const privacy = new ProjectAutomationPrivacy(db.sqlite);
    await privacy.quiesce(owner, 1);
    const exported = await privacy.export(owner);
    assert.equal(exported.complete, true);
    assert.equal(exported.records.automation.length, 16);
    db.sqlite
      .prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleting' WHERE owner_id=?")
      .run(owner);
    assert.equal((await privacy.delete(owner, 1)).deleted_records, 16);
    assert.equal((await privacy.delete(owner, 1)).deleted_records, 0);
    assert.equal(db.sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
    console.log("COMPILED_AUTOMATION_PLAYBOOKS_SCHEDULES_PRIVACY_ACTORS_PAY_DISABLED_PASS_NO_AI");
  } finally {
    await app.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase(":memory:");
  try {
    await runMigrations(db);
    await automationPreflight(db);
  } finally {
    db.close();
  }
}
