"use strict";

// Live-server acceptance smoke driver (LIVE_ACCEPTANCE_PLAN_RU.md): connects a
// freshly installed packaged Kosmora client to a real https origin WITHOUT
// credentials and asserts the honest unauthenticated state (/login redirect,
// origin persisted, no crash). The origin comes from the KOSMORA_LIVE_ORIGIN
// CI secret and is never written to disk. The workflow step must set the
// remote-origin env gate KOSMORA_GUI_ACCEPTANCE_ALLOW_REMOTE_ORIGIN=1; the
// packaged app independently re-validates both opt-ins and refuses a loopback
// origin. Exclusive to disposable GitHub-hosted Windows runners - never a
// developer's or the owner's machine.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertGuiAcceptanceEnvironment } = require("../gui-acceptance.cjs");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function parseLiveOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("KOSMORA_LIVE_ORIGIN is required for the live acceptance smoke.");
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("KOSMORA_LIVE_ORIGIN is not a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("KOSMORA_LIVE_ORIGIN must use https for a live server.");
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      "KOSMORA_LIVE_ORIGIN must not point at a loopback host; loopback runs are covered by the fixture acceptance."
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error("KOSMORA_LIVE_ORIGIN must not contain credentials.");
  }
  // Normalized schema://host:port - no path, query or hash ever reaches disk.
  return parsed.origin;
}

function runProcess(exePath, args, env, timeoutMs = 150000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Timed out waiting for ${path.basename(exePath)} (${args.join(" ")}): ${stderr.slice(-4000)} ${stdout.slice(-1000)}`
        )
      );
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-64000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-64000);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function resolveRunPaths({ appExePath, workRoot, environment, platform }) {
  assertGuiAcceptanceEnvironment({ isPackaged: true, environment, platform });
  const runnerRoot = fs.realpathSync(environment.RUNNER_TEMP);
  const root = fs.realpathSync(workRoot);
  const rootRelative = path.relative(runnerRoot, root);
  if (!rootRelative || rootRelative.startsWith("..") || path.isAbsolute(rootRelative))
    throw new Error("Live smoke work root must be within RUNNER_TEMP.");
  const resolvedApp = path.resolve(appExePath);
  if (!fs.existsSync(resolvedApp)) {
    throw new Error(`Installed Kosmora executable was not found: ${resolvedApp}`);
  }
  const appRelative = path.relative(root, fs.realpathSync(resolvedApp));
  if (
    !appRelative ||
    appRelative.startsWith("..") ||
    path.isAbsolute(appRelative) ||
    path.basename(resolvedApp) !== "Kosmora.exe"
  )
    throw new Error("Live smoke executable must be the installed Kosmora inside the work root.");
  return { runnerRoot, root, resolvedApp };
}

async function runPackagedLiveSmoke({
  appExePath,
  workRoot,
  origin,
  environment = process.env,
  platform = process.platform
}) {
  const { runnerRoot, resolvedApp } = resolveRunPaths({
    appExePath,
    workRoot,
    environment,
    platform
  });
  const liveOrigin = parseLiveOrigin(origin);
  const reportPath = path.join(runnerRoot, "cosmora-gui-acceptance-live-report.json");

  const tempDir = os.tmpdir();
  const runId = `${Date.now()}-${process.pid}`;
  const configPath = path.join(tempDir, `cosmora-gui-acceptance-config-${runId}.json`);
  const outputPath = path.join(tempDir, `cosmora-gui-acceptance-live-${runId}.json`);
  // The config opt-in half of the double gate; the env half must be provided
  // by the workflow step and is re-validated inside the packaged app.
  fs.writeFileSync(
    configPath,
    JSON.stringify({ phase: "live-smoke", origin: liveOrigin, remoteOrigin: true }),
    "utf8"
  );

  try {
    const proc = await runProcess(resolvedApp, ["--cosmora-gui-acceptance"], {
      COSMORA_GUI_ACCEPTANCE_CONFIG: configPath,
      COSMORA_GUI_ACCEPTANCE_OUTPUT: outputPath
    });
    if (proc.code !== 0) {
      throw new Error(
        `Live acceptance smoke exited with code ${proc.code}: ${proc.stderr.slice(-4000)}`
      );
    }
    const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    if (report?.ok !== true || report.phase !== "live-smoke") {
      throw new Error(`Unexpected live smoke report: ${JSON.stringify(report).slice(0, 2000)}`);
    }
    if (report.savedOrigin !== liveOrigin || report.landedOnLogin !== true) {
      throw new Error(
        `Live smoke did not land on the live origin's login: ${JSON.stringify(report).slice(0, 2000)}`
      );
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    let checkpoint = null;
    try {
      checkpoint = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch {
      checkpoint = null;
    }
    const message = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(reportPath, JSON.stringify({ ok: false, message, checkpoint }, null, 2));
    throw new Error(`${message}; live smoke checkpoint: ${JSON.stringify(checkpoint)}`, {
      cause: error
    });
  } finally {
    fs.rmSync(configPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const appIndex = args.indexOf("--app");
  const workRootIndex = args.indexOf("--work-root");
  const appExePath = appIndex >= 0 ? args[appIndex + 1] : null;
  const workRoot = workRootIndex >= 0 ? args[workRootIndex + 1] : null;
  if (!appExePath || !workRoot) {
    console.error("Usage: node ci/gui-acceptance-live.cjs --app <Kosmora.exe> --work-root <dir>");
    process.exitCode = 2;
  } else {
    runPackagedLiveSmoke({
      appExePath,
      workRoot,
      origin: process.env.KOSMORA_LIVE_ORIGIN
    })
      .then((report) => {
        process.stdout.write(
          `Live acceptance smoke OK: landed on login of ${report.savedOrigin}\n`
        );
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.stack || error.message : error);
        process.exitCode = 1;
      });
  }
}

module.exports = { parseLiveOrigin, runPackagedLiveSmoke };
