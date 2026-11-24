import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

/**
 * Isolated rehearsal of the release on the local host. No network provider, no
 * real database: MODEL_PROVIDER=mock and a temporary SQLite file. The web build
 * is reused from the host checkout when present; in CI the workflow builds it
 * from the release source first.
 *
 * Modes:
 *   node scripts/rehearse-release.mjs                      # full happy path
 *   node scripts/rehearse-release.mjs --fail-at <stage>    # rollback drill
 *   node scripts/rehearse-release.mjs --low-disk           # low-disk drill
 *
 * Stages (in order): prepare, migrate, api-start, api-health, web-start,
 * web-health, restart, verify-version, rollback.
 */
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const failAt = option("--fail-at");
const lowDisk = args.includes("--low-disk");
const reportDirOverride = option("--report-dir");
const stages = ["prepare", "migrate", "api-start", "api-health", "web-start", "web-health", "restart", "verify-version", "rollback"];
if (failAt !== undefined && !stages.includes(failAt)) {
  throw new Error(`Unknown stage. Choose one of: ${stages.join(", ")}`);
}

const sandbox = join(tmpdir(), `kosmora-rehearsal-${process.pid}`);
const db = join(sandbox, "data", "rehearsal.sqlite");
const ports = {
  // The web Next build bakes COSMORA_API_ORIGIN into its rewrites at build
  // time; the default build uses 3100, so the rehearsal API must use it too.
  api: Number(option("--api-port") ?? 3100),
  web: Number(option("--web-port") ?? 3181)
};
const env = {
  ...process.env,
  NODE_ENV: "test",
  API_HOST: "127.0.0.1",
  API_PORT: String(ports.api),
  WEB_ORIGIN: `http://127.0.0.1:${ports.web}`,
  COSMORA_API_ORIGIN: `http://127.0.0.1:${ports.api}`,
  DATABASE_URL: `file:${db}`,
  MODEL_PROVIDER: "mock",
  MODEL_PROVIDER_ID: "mock",
  MODEL_FALLBACK_TO_MOCK: "true",
  MOCK_PROVIDER_MODE: "success",
  RUNTIME_EMERGENCY_STOP: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  TURBO_TELEMETRY_DISABLED: "1"
};
const report = {
  format: "kosmora-rehearsal-v1",
  started_at: new Date().toISOString(),
  sandbox,
  ports,
  provider: "mock",
  database: db,
  low_disk_simulated: lowDisk,
  injected_failure: failAt ?? null,
  stages: [],
  status: "running",
  failed_stage: null,
  restore_command: null
};
const reportPath = reportDirOverride
  ? resolve(reportDirOverride, "rehearsal.json")
  : join(sandbox, "rehearsal.json");
const persistReport = () => {
  const directory = reportDirOverride ?? sandbox;
  mkdirSync(directory, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
};
const note = (stage, state, detail = {}) => {
  report.stages.push({ stage, state, at: new Date().toISOString(), ...detail });
  persistReport();
  if (failAt === stage && state === "start") {
    report.status = "failed";
    report.failed_stage = stage;
    report.restore_command =
      "bash scripts/deploy-release.sh --rollback <previous-image-digest> <previous-db-snapshot>";
    persistReport();
    throw new Error(`[${stage}] injected failure. Rollback: ${report.restore_command}`);
  }
};
const waitFor = async (url, predicate, timeoutMs = 25_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "error" });
      const body = await response.json().catch(() => ({}));
      if (response.ok && predicate(response.status, body)) return body;
      last = `${response.status} ${JSON.stringify(body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}; last: ${last}`);
};
const startProcess = (command, args, extraEnv, cwd = root) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("exit", (code) => (output += `\n[exited ${code}]\n`));
  return { child, output: () => output };
};
const stop = (child) =>
  new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3000).unref();
  });

let api;
let web;
try {
  note("prepare", "start");
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(join(sandbox, "data"), { recursive: true });
  if (lowDisk) {
    // Modeling only: record the simulated free-space bound and the release's
    // required disk bytes. No real disk is filled and no system limit is changed.
    report.low_disk = {
      simulated_free_bytes: 64 * 1024 * 1024,
      behavior: "preflight must refuse before unpack or migration, with a clear message"
    };
    note("prepare", "ok", { low_disk: report.low_disk });
    throw new Error(
      "LOW_DISK: refusing to unpack. Need at least the disk_bytes in build.json; " +
        "free 64 MiB is below the preflight threshold. Nothing was written."
    );
  }
  note("prepare", "ok");

  note("migrate", "start");
  // Prefer the compiled migration entrypoint; fall back to tsx for source trees
  // that have not been built yet (the CI workflow runs `pnpm build` first).
  const compiledMigration = join(root, "packages/db/dist/migrate.js");
  const migrationArgs = existsSync(compiledMigration)
    ? [compiledMigration]
    : [
        "--require", join(root, "scripts/windows-node-user.cjs"),
        "--import", pathToFileURL(join(root, "apps/api/node_modules/tsx/dist/loader.mjs")).href,
        "packages/db/src/migrate.ts"
      ];
  const migration = spawn(process.execPath, migrationArgs, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let migrationOutput = "";
  migration.stdout.on("data", (c) => (migrationOutput += c));
  migration.stderr.on("data", (c) => (migrationOutput += c));
  const migrationCode = await new Promise((r) => migration.once("exit", r));
  if (migrationCode !== 0) throw new Error(`migrate failed (${migrationCode}): ${migrationOutput}`);
  const journal = JSON.parse(readFileSync(join(root, "packages/db/migrations/meta/_journal.json"), "utf8"));
  note("migrate", "ok", { migrations: journal.entries.length, last: journal.entries.at(-1).tag });

  note("api-start", "start");
  const apiEntry = join(root, "apps/api/dist/server.js");
  const hasBuild = existsSync(apiEntry);
  if (!hasBuild) throw new Error("apps/api/dist/server.js missing; run pnpm --filter @cosmora/api build first.");
  api = startProcess(process.execPath, [apiEntry]);
  note("api-start", "ok", { built: true, pid: api.child.pid });

  note("api-health", "start");
  const apiHealth = await waitFor(
    `http://127.0.0.1:${ports.api}/api/v1/health`,
    (status, body) => status === 200 && body.status === "ok" && body.database === "ok"
  );
  note("api-health", "ok", { health: apiHealth });
  const runtime = await waitFor(
    `http://127.0.0.1:${ports.api}/api/v1/model-runtime`,
    (status, body) => status === 200 && body.mode === "mock"
  );
  report.mock_runtime = runtime;

  note("web-start", "start");
  const webDir = join(root, "apps/web");
  if (!existsSync(join(webDir, ".next", "BUILD_ID"))) {
    throw new Error("apps/web/.next missing; run pnpm --filter @cosmora/web build first.");
  }
  const nextBin = join(webDir, "node_modules", "next", "dist", "bin", "next");
  web = startProcess(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(ports.web)], {
    COSMORA_API_ORIGIN: env.COSMORA_API_ORIGIN
  }, webDir);
  note("web-start", "ok", { pid: web.child.pid });

  note("web-health", "start");
  await waitFor(`http://127.0.0.1:${ports.web}/`, (status) => status === 200);
  const proxied = await waitFor(
    `http://127.0.0.1:${ports.web}/api/v1/health`,
    (status, body) => status === 200 && body.database === "ok"
  );
  note("web-health", "ok", { proxied_health: proxied });

  note("restart", "start");
  await stop(api);
  api = startProcess(process.execPath, [apiEntry]);
  await waitFor(
    `http://127.0.0.1:${ports.api}/api/v1/health`,
    (status, body) => status === 200 && body.database === "ok"
  );
  note("restart", "ok");

  note("verify-version", "start");
  const dbHash = createHash("sha256").update(readFileSync(db)).digest("hex");
  report.database_sha256_after_restart = dbHash;
  note("verify-version", "ok", { database_sha256: dbHash });

  note("rollback", "start");
  // Rollback is a restart of the previous known-good API against the same
  // compatible schema; no data is deleted. In production the image digest is
  // selected explicitly from build.json, never a mutable ':latest' tag.
  await stop(api);
  api = startProcess(process.execPath, [apiEntry]);
  const afterRollback = await waitFor(
    `http://127.0.0.1:${ports.api}/api/v1/health`,
    (status, body) => status === 200 && body.database === "ok"
  );
  const dbHashAfter = createHash("sha256").update(readFileSync(db)).digest("hex");
  if (dbHashAfter !== dbHash) throw new Error("Rollback changed the database; data safety violation.");
  note("rollback", "ok", { health: afterRollback, database_unchanged: true });

  report.status = "pass";
} catch (error) {
  if ((api && !report.stages.some((s) => s.stage === "api-health" && s.state === "ok")) || web) {
    report.child_output = {
      api: api?.output().slice(-4000) ?? null,
      web: web?.output().slice(-4000) ?? null
    };
  }
  if (!report.failed_stage) {
    report.status = "error";
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.restore_command =
    report.restore_command ??
    "bash scripts/deploy-release.sh --rollback <previous-image-digest> <previous-db-snapshot>";
  process.exitCode = 1;
  process.stderr.write(`Rehearsal FAILED: ${report.error ?? `stage ${report.failed_stage}`}\n`);
} finally {
  await stop(api);
  await stop(web);
  report.finished_at = new Date().toISOString();
  persistReport();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
