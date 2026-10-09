import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdentityStore, openDatabase, runMigrations } from "../../../packages/db/dist/index.js";
import { maintenanceStatus, prepareMaintenance, finishMaintenance } from "../maintenance.mjs";

const now = Date.parse("2026-10-08T19:00:00Z");
const owner = "hosted-alpha-owner";
async function fixture(t, ttlMs = 3600_000) {
  const directory = mkdtempSync(join(tmpdir(), "kosmora-maintenance-"));
  const databaseUrl = `file:${join(directory, "test.sqlite")}`;
  const database = openDatabase(databaseUrl);
  await runMigrations(database);
  const store = new IdentityStore(database.sqlite, { now: () => now });
  store.registerActor(owner, owner, "owner");
  const issued = store.issueSession({
    ownerId: owner,
    actorId: owner,
    assurance: "multi_factor",
    ttlMs
  });
  const sessionFile = join(directory, "owner-session.env");
  writeFileSync(sessionFile, `COSMORA_OWNER_SESSION_TOKEN=${issued.token}\n`);
  const registryFile = join(directory, "registry.json");
  const registry = JSON.parse(
    readFileSync(
      new URL(
        "../../../config/model-registry.cheapvibecode.manager-work-preview.v1.json",
        import.meta.url
      )
    )
  );
  registry.entries[1].source.valid_until = new Date(now + 3600_000).toISOString();
  writeFileSync(registryFile, JSON.stringify(registry));
  const env = {
    MODEL_PROVIDER_ID: "cheapvibecode",
    MODEL_NAME: "gpt-5.5",
    MODEL_PROVIDER: "openai-compatible",
    MODEL_BASE_URL: "https://ru.cheapvibecode.ru/v1",
    COSMORA_ALLOW_PAID_CONNECTION_TEST: "SEND_ONE_BOUNDED_REQUEST"
  };
  const options = {
    store,
    databaseUrl,
    sessionFile,
    registryFile,
    directory: join(directory, "stage"),
    backupDirectory: join(directory, "backups"),
    env,
    now,
    discovery: async (received) => {
      assert.equal(received.COSMORA_ALLOW_PAID_CONNECTION_TEST, "");
      return { mode: "discovery", generation_requests: 0, model_available: true };
    }
  };
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { options, issued, registry, directory };
}

test("rotation keeps old bearer alive until commit and preserves assurance/capabilities", async (t) => {
  const { options, issued, registry } = await fixture(t);
  const state = await prepareMaintenance(options);
  assert.equal(state.phase, "prepared");
  assert.equal(state.generation_requests, 0);
  assert.ok(options.store.resolveSession(issued.token));
  const candidate = readFileSync(join(options.directory, "session.new.env"), "utf8")
    .trim()
    .split("=")[1];
  assert.equal(options.store.resolveSession(candidate).assurance, "multi_factor");
  assert.equal(
    readFileSync(options.sessionFile, "utf8"),
    `COSMORA_OWNER_SESSION_TOKEN=${issued.token}\n`
  );
  const refreshed = JSON.parse(readFileSync(join(options.directory, "registry.new.json")));
  const before = structuredClone(registry.entries[1]);
  const after = structuredClone(refreshed.entries[1]);
  delete before.source;
  delete after.source;
  assert.deepEqual(after, before);
  assert.ok(readFileSync(state.backup).length > 0);
  assert.ok(!JSON.stringify(state).includes(issued.token));
  finishMaintenance(options.store, options.directory, "commit");
  assert.equal(options.store.resolveSession(issued.token), null);
  assert.ok(options.store.resolveSession(candidate));
});

test("rollback revokes candidate only and retains current authorization", async (t) => {
  const { options, issued } = await fixture(t);
  await prepareMaintenance(options);
  const candidate = readFileSync(join(options.directory, "session.new.env"), "utf8")
    .trim()
    .split("=")[1];
  finishMaintenance(options.store, options.directory, "rollback");
  assert.ok(options.store.resolveSession(issued.token));
  assert.equal(options.store.resolveSession(candidate), null);
  assert.throws(
    () => finishMaintenance(options.store, options.directory, "commit"),
    /not pending/u
  );
});

test("failed discovery never mints a new bearer", async (t) => {
  const { options, issued } = await fixture(t);
  options.discovery = async () => {
    throw new Error("provider unavailable");
  };
  await assert.rejects(prepareMaintenance(options));
  assert.ok(options.store.resolveSession(issued.token));
  assert.equal(options.store.listSessions(owner).length, 1);
});

test("interrupted commit retains candidate and can resume without restoring revoked bearer", async (t) => {
  const { options, issued } = await fixture(t);
  await prepareMaintenance(options);
  const candidate = readFileSync(join(options.directory, "session.new.env"), "utf8")
    .trim()
    .split("=")[1];
  const revoke = options.store.revokeSession.bind(options.store);
  options.store.revokeSession = (...args) => {
    revoke(...args);
    throw new Error("fixture interruption after revocation");
  };
  assert.throws(() => finishMaintenance(options.store, options.directory, "commit"));
  assert.equal(JSON.parse(readFileSync(join(options.directory, "state.json"))).phase, "committing");
  assert.equal(options.store.resolveSession(issued.token), null);
  assert.ok(options.store.resolveSession(candidate));
  assert.throws(
    () => finishMaintenance(options.store, options.directory, "rollback"),
    /not pending/u
  );
  options.store.revokeSession = revoke;
  assert.equal(finishMaintenance(options.store, options.directory, "commit").phase, "committed");
});

test("fresh service session is retained, while registry can be refreshed independently", async (t) => {
  const { options, issued } = await fixture(t, 7 * 86_400_000);
  const state = await prepareMaintenance(options);
  assert.equal(state.session_due, false);
  assert.equal(state.registry_due, true);
  assert.equal(state.new_session_id, null);
  finishMaintenance(options.store, options.directory, "commit");
  assert.ok(options.store.resolveSession(issued.token));
});

test("scheduled maintenance cannot revive revoked authorization or switch model", async (t) => {
  const { options, issued } = await fixture(t);
  options.env.MODEL_NAME = "other-model";
  assert.throws(() => maintenanceStatus(options), /approved provider/u);
  options.env.MODEL_NAME = "gpt-5.5";
  options.store.revokeSession(issued.session.session_id, owner, owner, "fixture logout");
  assert.throws(() => maintenanceStatus(options), /not authorized/u);
});
