import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
// Dedicated daemon namespace: clear jobs orphaned by a sidecar crash before accepting work.
const previous = invoke(["ps", "-aq", "--filter", "label=kosmora.code-executor=true"]);
if (previous.status !== 0) throw new Error("EXECUTOR_DAEMON_UNAVAILABLE");
const ids = previous.stdout.trim().split(/\s+/).filter(Boolean);
if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("INVALID_CONTAINER_ID");
if (ids.length && invoke(["rm", "--force", ...ids]).status !== 0)
  throw new Error("ORPHAN_CLEANUP_UNVERIFIED");
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
