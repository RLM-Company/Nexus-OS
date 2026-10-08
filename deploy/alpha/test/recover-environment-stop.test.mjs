import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { recoverEnvironmentStop } from "../recover-environment-stop.mjs";

const activation = "2026-10-08T00:00:00.000Z";
const input = {
  apiStopped: "1",
  runtimeEmergencyStop: "false",
  acknowledgement: "CLEAR ENVIRONMENT STOP OFFLINE",
  expectedActivatedAt: activation,
  ownerId: "owner",
  reason: "Owner funded provider and requested a short live test"
};
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE projects (id TEXT PRIMARY KEY); CREATE TABLE identity_actors (actor_id TEXT PRIMARY KEY, owner_id TEXT, kind TEXT, status TEXT)"
  );
  for (const file of ["0007_perpetual_supernaut.sql", "0016_yellow_katie_power.sql"]) {
    db.exec(
      readFileSync(new URL(`../../../packages/db/migrations/${file}`, import.meta.url), "utf8")
    );
  }
  db.exec(
    "INSERT INTO identity_actors VALUES ('owner','owner','owner','active'); INSERT INTO projects VALUES ('project')"
  );
  db.prepare(
    "INSERT INTO emergency_stops VALUES ('process','process',NULL,1,'environment funding pause',?,'system:environment',NULL,NULL)"
  ).run(activation);
  db.prepare(
    "INSERT INTO emergency_stops VALUES ('project:project','project','project',1,'project pause',?,'owner',NULL,NULL)"
  ).run(activation);
  return db;
}

test("offline recovery retains activation facts in immutable audit and only clears the environment process stop", (t) => {
  const db = fixture(t);
  const event = recoverEnvironmentStop(db, input);
  assert.equal(
    db.prepare("SELECT active FROM emergency_stops WHERE scope_key = 'process'").get().active,
    0
  );
  assert.equal(
    db.prepare("SELECT active FROM emergency_stops WHERE scope_key = 'project:project'").get()
      .active,
    1
  );
  const audit = db.prepare("SELECT * FROM emergency_stop_clearance_events").get();
  assert.equal(audit.event_id, event.event_id);
  assert.equal(audit.activated_by, "system:environment");
  assert.equal(audit.activated_at, activation);
  assert.equal(audit.clearance_reason, input.reason);
  assert.throws(() => db.exec("DELETE FROM emergency_stop_clearance_events"), /append-only/);
  assert.throws(
    () => db.exec("UPDATE emergency_stop_clearance_events SET clearance_reason = 'changed'"),
    /append-only/
  );
  assert.throws(() => recoverEnvironmentStop(db, input), /no longer active/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM emergency_stop_clearance_events").get().n, 1);
});

for (const [name, changed] of [
  ["API still running", { apiStopped: "0" }],
  ["switch still enabled", { runtimeEmergencyStop: "true" }],
  ["missing acknowledgement", { acknowledgement: "" }],
  ["missing reason", { reason: " " }],
  ["stale activation", { expectedActivatedAt: "2026-10-07T00:00:00.000Z" }],
  ["unknown owner", { ownerId: "other" }]
])
  test(`offline recovery rejects ${name} without changing stop or audit`, (t) => {
    const db = fixture(t);
    assert.throws(() => recoverEnvironmentStop(db, { ...input, ...changed }));
    assert.equal(
      db.prepare("SELECT active FROM emergency_stops WHERE scope_key = 'process'").get().active,
      1
    );
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM emergency_stop_clearance_events").get().n,
      0
    );
  });

test("offline recovery cannot clear an owner-triggered stop or impersonate a non-owner actor", (t) => {
  const db = fixture(t);
  db.exec("UPDATE emergency_stops SET activated_by = 'owner' WHERE scope_key = 'process'");
  assert.throws(() => recoverEnvironmentStop(db, input));
  db.exec(
    "UPDATE emergency_stops SET activated_by = 'system:environment' WHERE scope_key = 'process'; UPDATE identity_actors SET kind = 'agent'"
  );
  assert.throws(() => recoverEnvironmentStop(db, input), /active owner/);
});

test("a failed audit write rolls the stop change back", (t) => {
  const db = fixture(t);
  db.exec(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON emergency_stop_clearance_events BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END"
  );
  assert.throws(() => recoverEnvironmentStop(db, input), /audit unavailable/);
  assert.equal(
    db.prepare("SELECT active FROM emergency_stops WHERE scope_key = 'process'").get().active,
    1
  );
});
