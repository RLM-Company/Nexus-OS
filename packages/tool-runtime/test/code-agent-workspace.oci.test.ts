import { describe, expect, it } from "vitest";
import {
  computeCodeAgentSnapshotDigest,
  createCodeAgentWorkspaceRunner
} from "../src/code-agent-workspace.js";

// Operator opt-in only: no image pulls and no replacement sandbox. CI without a local OCI
// daemon AND a provisioned immutable Node image reports these real integration tests skipped.
const image = process.env.CODE_AGENT_TEST_IMAGE;
const runtime = process.env.CODE_AGENT_TEST_RUNTIME === "podman" ? "podman" : "docker";
const executable = process.env.CODE_AGENT_TEST_EXECUTABLE;
const runner = () =>
  createCodeAgentWorkspaceRunner({
    runtime,
    image: image!,
    ...(executable ? { executable } : {}),
    limits: { timeoutMs: 5_000 }
  });

describe.skipIf(!image)("CodeAgent actual OCI integration (operator opt-in)", () => {
  it("executes the failing bug and the selected corrected snapshot", async () => {
    const test = {
      path: "sum.test.mjs",
      content:
        "import test from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './sum.mjs'; test('adds', () => assert.equal(sum(2,3),5));"
    };
    const before = [{ path: "sum.mjs", content: "export const sum = (a,b) => a-b;" }, test];
    const after = [{ path: "sum.mjs", content: "export const sum = (a,b) => a+b;" }, test];
    expect(
      await runner().run({
        files: before,
        check: "node-test",
        expectedDigest: computeCodeAgentSnapshotDigest(before)
      })
    ).toMatchObject({ status: "failed", exitCode: 1, cleanupVerified: true });
    expect(
      await runner().run({
        files: after,
        check: "node-test",
        expectedDigest: computeCodeAgentSnapshotDigest(after)
      })
    ).toMatchObject({ status: "passed", exitCode: 0, cleanupVerified: true });
  }, 20_000);

  it("runs non-root with no host socket, no writable snapshot and no external network", async () => {
    const result = await runner().run({
      check: "node-test",
      files: [
        {
          path: "isolation.test.mjs",
          content: `
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
test('uid and readonly workspace', () => {
  assert.equal(process.getuid(), 65534);
  assert.equal(fs.existsSync('/var/run/docker.sock'), false);
  assert.equal(process.cwd(), '/snapshot/workspace');
  assert.throws(() => fs.writeFileSync(process.cwd() + '/injected.js', 'x'));
  assert.throws(() => fs.chmodSync(process.cwd() + '/isolation.test.mjs', 0o777));
  assert.throws(() => fs.writeFileSync(process.cwd() + '/isolation.test.mjs', 'x'));
  fs.writeFileSync('/tmp/scratch', 'temporary output');
  assert.throws(() => fs.writeFileSync('/root/injected.js', 'x'));
});
test('external network denied', async () => {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.once('connect', () => { socket.destroy(); reject(new Error('NETWORK_ISOLATION_BROKEN')); });
    socket.once('error', () => { socket.destroy(); resolve(); });
    socket.setTimeout(800, () => { socket.destroy(); resolve(); });
  });
});
`
        }
      ]
    });
    expect(result).toMatchObject({ status: "passed", exitCode: 0, cleanupVerified: true });
  }, 10_000);

  it("preserves Unicode paths and content in the immutable snapshot", async () => {
    const result = await runner().run({
      check: "node-test",
      files: [
        { path: "папка/данные.txt", content: "Космора 🚀\n" },
        {
          path: "unicode.test.mjs",
          content:
            "import fs from 'node:fs'; import assert from 'node:assert/strict'; assert.equal(fs.readFileSync('папка/данные.txt','utf8'), 'Космора 🚀\\n');"
        }
      ]
    });
    expect(result).toMatchObject({ status: "passed", exitCode: 0, cleanupVerified: true });
  }, 10_000);

  it("times out and removes a container including descendant processes", async () => {
    const result = await runner().run({
      check: "node-test",
      files: [
        {
          path: "infinite.test.mjs",
          content: `
import { spawn } from 'node:child_process';
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
setInterval(() => {}, 1000);
`
        }
      ]
    });
    expect(result).toMatchObject({ status: "timed_out", cleanupVerified: true });
  }, 10_000);
});
