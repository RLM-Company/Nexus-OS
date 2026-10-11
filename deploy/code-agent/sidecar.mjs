import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  createCodeAgentExecutorServer,
  createCodeAgentWorkspaceRunner
} from "../../packages/tool-runtime/dist/index.js";
const executable = "/usr/bin/docker";
const environment = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
const invoke = (args) =>
  spawnSync(executable, args, {
    env: environment,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
    shell: false
  });
// Dedicated job labels: clear jobs orphaned by a sidecar crash before accepting work.
const previous = invoke(["ps", "-aq", "--filter", "label=kosmora.code-executor=true"]);
if (previous.status !== 0) throw new Error("EXECUTOR_DAEMON_UNAVAILABLE");
const ids = previous.stdout.trim().split(/\s+/).filter(Boolean);
if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("INVALID_CONTAINER_ID");
if (ids.length && invoke(["rm", "--force", ...ids]).status !== 0)
  throw new Error("ORPHAN_CLEANUP_UNVERIFIED");
const remaining = invoke(["ps", "-aq", "--filter", "label=kosmora.code-executor=true"]);
if (remaining.status !== 0 || remaining.stdout.trim()) throw new Error("ORPHAN_CLEANUP_UNVERIFIED");
// Snapshot volumes survive a crash independently of containers. Remove only our labelled,
// generated names after proving every orphaned job container has gone; never prune the daemon.
const snapshots = invoke([
  "volume",
  "ls",
  "--filter",
  "label=kosmora.code-executor=true",
  "--format",
  "{{.Name}}"
]);
if (snapshots.status !== 0) throw new Error("EXECUTOR_DAEMON_UNAVAILABLE");
const volumes = snapshots.stdout.trim().split(/\s+/).filter(Boolean);
if (volumes.some((name) => !/^kosmora-snapshot-[a-f0-9-]{36}$/.test(name)))
  throw new Error("INVALID_SNAPSHOT_VOLUME");
if (volumes.length && invoke(["volume", "rm", ...volumes]).status !== 0)
  throw new Error("ORPHAN_SNAPSHOT_CLEANUP_UNVERIFIED");
const remainingVolumes = invoke([
  "volume",
  "ls",
  "--filter",
  "label=kosmora.code-executor=true",
  "--format",
  "{{.Name}}"
]);
if (remainingVolumes.status !== 0 || remainingVolumes.stdout.trim())
  throw new Error("ORPHAN_SNAPSHOT_CLEANUP_UNVERIFIED");
const runner = createCodeAgentWorkspaceRunner({
  runtime: "docker",
  image: process.env.CODE_AGENT_SANDBOX_IMAGE,
  executable
});
const sidecar = createCodeAgentExecutorServer({
  token: readFileSync("/run/secrets/code_executor_token", "utf8").trim(),
  runner
});
sidecar.server.listen(3210, "0.0.0.0");
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void sidecar
      .stop()
      .then(() => {
        process.exitCode = 0;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  });
