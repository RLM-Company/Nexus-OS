// Real OCI + real HTTP opt-in. Never substitutes a fixture, pulls an image or sends model/GitHub requests.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { setTimeout } from "node:timers";
import {
  createCodeAgentExecutorServer,
  createCodeAgentHttpExecutor,
  applyCodeAgentUnifiedDiff,
  computeCodeAgentSnapshotDigest,
  createCodeAgentWorkspaceRunner
} from "../../packages/tool-runtime/dist/index.js";
const image = process.env.CODE_AGENT_TEST_IMAGE;
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
  throw new Error("Set CODE_AGENT_TEST_IMAGE to a provisioned local sha256 image ID");
const runtime = process.env.CODE_AGENT_TEST_RUNTIME === "podman" ? "podman" : "docker";
const executable = process.env.CODE_AGENT_TEST_EXECUTABLE ?? `/usr/bin/${runtime}`;
const environment = { PATH: "/usr/bin:/bin", HOME: "/nonexistent" };
const cli = (args) =>
  spawnSync(executable, args, {
    env: environment,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536
  });
assert.equal(cli(["info"]).status, 0, "Actual OCI daemon must be reachable");
assert.equal(cli(["image", "inspect", image]).status, 0, "Pinned image must exist locally");
const token = randomBytes(32).toString("hex");
const sidecar = createCodeAgentExecutorServer({
  token,
  runner: createCodeAgentWorkspaceRunner({
    runtime,
    executable,
    image,
    limits: { timeoutMs: 2500, outputBytes: 4096 }
  })
});
await new Promise((resolve) => sidecar.server.listen(0, "127.0.0.1", resolve));
const client = createCodeAgentHttpExecutor({
  url: `http://127.0.0.1:${sidecar.server.address().port}`,
  token
});
const test = {
  path: "sum.test.mjs",
  content: `import assert from 'node:assert/strict'; import {sum} from './sum.mjs'; assert.equal(sum(2,3),5);`
};
const run = (files) => client.run({ files, check: "node-test" });
const verify = (value, status) => {
  assert.equal(value.status, status);
  assert.equal(value.cleanupVerified, true);
};
try {
  verify(
    await run([{ path: "sum.mjs", content: "export const sum = (a,b) => a-b;" }, test]),
    "failed"
  );
  const before = [{ path: "sum.mjs", content: "export const sum = (a,b) => a-b;" }, test];
  const patch =
    "diff --git a/sum.mjs b/sum.mjs\n--- a/sum.mjs\n+++ b/sum.mjs\n@@ -1,99 +1,99 @@\n-export const sum = (a,b) => a-b;\n\\ No newline at end of file\n+export const sum = (a,b) => a+b;\n\\ No newline at end of file\n";
  const applied = applyCodeAgentUnifiedDiff({
    diff: patch,
    snapshot: before,
    baseSha: "a".repeat(40),
    expectedBaseSha: "a".repeat(40),
    expectedSnapshotDigest: computeCodeAgentSnapshotDigest(before)
  });
  assert.equal(applied.normalizations.length, 1);
  assert.throws(() =>
    applyCodeAgentUnifiedDiff({
      diff: patch.replace("a-b", "a*b"),
      snapshot: before,
      baseSha: "a".repeat(40),
      expectedBaseSha: "a".repeat(40),
      expectedSnapshotDigest: computeCodeAgentSnapshotDigest(before)
    })
  );
  verify(
    await run([...applied.files.map(({ path, content }) => ({ path, content })), test]),
    "passed"
  );
  verify(
    await run([
      {
        path: "isolation.test.mjs",
        content: `
import assert from 'node:assert/strict'; import fs from 'node:fs'; import net from 'node:net';
assert.equal(process.getuid(),65534);
for (const name of ['CODE_AGENT_EXECUTOR_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','DOCKER_HOST']) assert.equal(process.env[name],undefined);
assert.equal(fs.existsSync('/var/run/docker.sock'),false);
assert.equal(process.cwd(),'/snapshot/workspace');
assert.throws(()=>fs.writeFileSync(process.cwd()+'/other.js','x'));
assert.throws(()=>fs.chmodSync(process.cwd()+'/isolation.test.mjs',0o777));
assert.throws(()=>fs.writeFileSync(process.cwd()+'/isolation.test.mjs','x'));
fs.writeFileSync('/tmp/check-output','scratch is allowed');
assert.throws(()=>fs.writeFileSync('/etc/other','x'));
await new Promise((resolve,reject)=>{ const socket=net.connect({host:'1.1.1.1',port:443}); socket.once('connect',()=>{socket.destroy();reject(new Error('NETWORK_ALLOWED'));});socket.once('error',()=>{socket.destroy();resolve();});socket.setTimeout(500,()=>{socket.destroy();resolve();}); });
`
      }
    ]),
    "passed"
  );
  const waiting = [
    {
      path: "wait.test.mjs",
      content: `import {spawn} from 'node:child_process'; spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); setInterval(()=>{},1000);`
    }
  ];
  verify(await run(waiting), "timed_out");
  const controller = new globalThis.AbortController();
  const cancelled = client.run({ files: waiting, check: "node-test", signal: controller.signal });
  setTimeout(() => controller.abort(), 500);
  verify(await cancelled, "cancelled");
  const flood = await run([
    {
      path: "flood.test.mjs",
      content: `setInterval(()=>process.stdout.write('x'.repeat(8192)),1);`
    }
  ]);
  verify(flood, "failed");
  assert.equal(flood.truncated, true);
  assert.ok(Buffer.byteLength(flood.stdout) + Buffer.byteLength(flood.stderr) <= 4096);
  const output = await run([
    { path: "redact.test.mjs", content: `console.log('Bearer smoke-only-value');` }
  ]);
  verify(output, "passed");
  assert.ok(!output.stdout.includes("smoke-only-value"));
  const remaining = cli(["ps", "-aq", "--filter", "label=kosmora.code-executor=true"]);
  assert.equal(remaining.status, 0);
  assert.equal(remaining.stdout.trim(), "", "No live or stopped job containers may remain");
  const volumes = cli([
    "volume",
    "ls",
    "--filter",
    "label=kosmora.code-executor=true",
    "--format",
    "{{.Name}}"
  ]);
  assert.equal(volumes.status, 0);
  assert.equal(volumes.stdout.trim(), "", "No snapshot volumes may remain");
  console.log(
    "PASS real OCI + HTTP: bug/fix, readonly/non-root/no-network/no-secrets, timeout, cancellation, output cap/redaction, daemon cleanup"
  );
} finally {
  await sidecar.stop();
}
