import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { IdentityStore, openDatabase } from "../../packages/db/dist/index.js";
import { ModelRegistry } from "../../packages/model-gateway/dist/index.js";
import { checkProviderConnection } from "../../scripts/provider-connection-check.mjs";
import { createBackup } from "./sqlite-backup.mjs";

const owner = "hosted-alpha-owner";
const day = 86_400_000;
const renewalWindow = 2 * day;
const atomic = (path, value) => {
  const temporary = `${path}.${process.pid}.new`;
  writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
};
const requireState = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function maintenanceStatus({ store, sessionFile, registryFile, env, now = Date.now() }) {
  const sessionText = readFileSync(sessionFile, "utf8");
  const token = /^COSMORA_OWNER_SESSION_TOKEN=(cosmora_session_[A-Za-z0-9_-]{43,})$/mu.exec(
    sessionText
  )?.[1];
  requireState(token, "Current service credential is invalid");
  const context = store.resolveSession(token);
  // Never resurrect a revoked/expired/disabled identity from a scheduled job.
  requireState(
    context?.owner_id === owner && context?.actor_id === owner && context?.actor_kind === "owner",
    "Current owner service session is not authorized"
  );
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  const routes = registry.entries?.filter(
    (entry) => entry.status === "active" && entry.protocol !== "mock"
  );
  requireState(routes?.length === 1, "Maintenance supports one approved external route");
  const route = routes[0];
  const reference = `${env.MODEL_BASE_URL?.replace(/\/$/u, "")}/models`;
  requireState(
    route.provider_id === env.MODEL_PROVIDER_ID &&
      route.model_id === env.MODEL_NAME &&
      route.protocol === env.MODEL_PROVIDER &&
      route.source.kind === "authorized_discovery" &&
      route.source.reference === reference,
    "Registry route does not match the approved provider"
  );
  const registryExpiry = Date.parse(route.source.valid_until);
  const sessionExpiry = Date.parse(context.expires_at);
  requireState(Number.isFinite(registryExpiry) && Number.isFinite(sessionExpiry), "Invalid expiry");
  return {
    session_due: sessionExpiry - now <= renewalWindow,
    registry_due: registryExpiry - now <= renewalWindow,
    session_expires_at: context.expires_at,
    registry_expires_at: route.source.valid_until,
    old_session_id: context.session_id,
    assurance: context.assurance,
    generation_requests: 0
  };
}

export async function prepareMaintenance(options) {
  const { store, sessionFile, registryFile, env, directory, now = Date.now() } = options;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stateFile = join(directory, "state.json");
  requireState(!existsSync(stateFile), "Recover the pending transaction before preparing another");
  const status = maintenanceStatus(options);
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  if (status.registry_due) {
    // Scheduled discovery cannot opt in to POST/generation, even if the host env did.
    const result = await (options.discovery ?? checkProviderConnection)({
      ...env,
      COSMORA_ALLOW_PAID_CONNECTION_TEST: ""
    });
    requireState(
      result.mode === "discovery" && result.generation_requests === 0 && result.model_available,
      "Read-only discovery did not confirm the approved route"
    );
    const timestamp = new Date(now).toISOString();
    registry.generated_at = timestamp;
    registry.registry_version = `approved-maintenance-${timestamp}`;
    const route = registry.entries.find(
      (entry) => entry.protocol !== "mock" && entry.status === "active"
    );
    route.source.verified_at = timestamp;
    route.source.valid_until = new Date(now + 7 * day).toISOString();
    // Keep model, roles, capabilities, privacy, prices and token limits unchanged.
  }
  new ModelRegistry(registry, { now: () => now });
  const backup = await (options.backup ?? createBackup)(
    options.databaseUrl,
    options.backupDirectory
  );
  atomic(join(directory, "registry.old.json"), readFileSync(registryFile));
  atomic(join(directory, "registry.new.json"), JSON.stringify(registry, null, 2) + "\n");
  atomic(join(directory, "session.old.env"), readFileSync(sessionFile));
  const state = {
    version: 1,
    phase: "prepared",
    ...status,
    new_session_id: null,
    backup: backup.manifestPath
  };
  atomic(stateFile, JSON.stringify(state) + "\n");
  if (status.session_due) {
    const issued = store.issueSession({
      ownerId: owner,
      actorId: owner,
      assurance: status.assurance,
      ttlMs: 7 * day
    });
    state.new_session_id = issued.session.session_id;
    state.session_expires_at = issued.session.expires_at;
    // Persist identity before publishing a credential so rollback can revoke it.
    atomic(stateFile, JSON.stringify(state) + "\n");
    atomic(join(directory, "session.new.env"), `COSMORA_OWNER_SESSION_TOKEN=${issued.token}\n`);
  }
  state.registry_expires_at = registry.entries.find(
    (entry) => entry.protocol !== "mock" && entry.status === "active"
  ).source.valid_until;
  atomic(stateFile, JSON.stringify(state) + "\n");
  return state;
}

export function finishMaintenance(store, directory, operation) {
  requireState(["commit", "rollback"].includes(operation), "Invalid maintenance operation");
  const file = join(directory, "state.json");
  const state = JSON.parse(readFileSync(file, "utf8"));
  requireState(
    state.version === 1 &&
      (state.phase === "prepared" || (operation === "commit" && state.phase === "committing")),
    "Transaction is not pending"
  );
  if (state.new_session_id) {
    const revoked = operation === "commit" ? state.old_session_id : state.new_session_id;
    if (operation === "commit") {
      const session = store.getSession(state.new_session_id, owner);
      requireState(
        session?.status === "active" && session.actor_id === owner,
        "New session is unavailable"
      );
      // After this durable point the host must retain the verified candidate.
      // A crash after revoking the old bearer cannot roll back to a dead token.
      state.phase = "committing";
      atomic(file, JSON.stringify(state) + "\n");
    }
    store.revokeSession(revoked, owner, owner, `Hosted maintenance ${operation}`);
  }
  state.phase = operation === "commit" ? "committed" : "rolled_back";
  atomic(file, JSON.stringify(state) + "\n");
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const databaseUrl = process.env.DATABASE_URL ?? "file:/var/lib/cosmora/cosmora.db";
  const database = openDatabase(databaseUrl);
  try {
    const options = {
      store: new IdentityStore(database.sqlite),
      databaseUrl,
      backupDirectory: "/run/cosmora-backups",
      sessionFile: "/run/cosmora-current/owner-session.env",
      registryFile: process.env.MODEL_REGISTRY_PATH,
      directory: "/run/cosmora-stage",
      env: process.env
    };
    let result;
    if (process.argv[2] === "status") result = maintenanceStatus(options);
    else if (process.argv[2] === "prepare") result = await prepareMaintenance(options);
    else if (process.argv[2] === "backup")
      result = await createBackup(databaseUrl, options.backupDirectory);
    else result = finishMaintenance(options.store, options.directory, process.argv[2]);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    // Exception strings can contain filesystem/provider data; the journal gets no secrets.
    process.stderr.write("Kosmora maintenance failed; existing credentials were not disclosed.\n");
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
