import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeCodeAgentSnapshotDigest,
  createCodeAgentWorkspaceRunner
} from "../src/code-agent-workspace.js";

const IMAGE = `sha256:${"a".repeat(64)}`;
const files = [
  { path: "src/example.test.mjs", content: "import test from 'node:test'; test('ok', () => {});" }
];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

// This executable is a transport fixture, NEVER a sandbox fallback. It does not execute
// repository contents; it only exercises the real child process lifecycle and CLI boundary.
async function fixture(mode: "success" | "flood" | "wait" | "unavailable" | "cleanup-fail") {
  const directory = await mkdtemp(join(tmpdir(), "kosmora-oci-transport-test-"));
  directories.push(directory);
  const executable = join(directory, "oci-fixture");
  const record = join(directory, "calls.jsonl");
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, env: process.env }) + '\\n');
if (args[0] === 'rm') process.exit(${JSON.stringify(mode)} === 'cleanup-fail' ? 1 : 0);
if (${JSON.stringify(mode)} === 'unavailable') process.exit(125);
if (args[0] === 'cp') { process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); return; }
if (args[0] === 'create') { process.stdout.write('fixture-container-id'); process.exit(0); }
if (${JSON.stringify(mode)} === 'wait' || ${JSON.stringify(mode)} === 'cleanup-fail') setInterval(() => {}, 1000);
else if (${JSON.stringify(mode)} === 'flood') { setInterval(() => process.stdout.write('x'.repeat(8192)), 1); }
else { process.stdout.write('transport fixture only'); process.exit(0); }
`,
    { mode: 0o700 }
  );
  const calls = async () =>
    (await readFile(record, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; env: Record<string, string> });
  return { executable, calls };
}

describe("CodeAgent workspace boundary", () => {
  it("binds content and paths in an order-independent digest", () => {
    const a = [
      { path: "a.js", content: "ab" },
      { path: "b.js", content: "c" }
    ];
    expect(computeCodeAgentSnapshotDigest(a)).toBe(
      computeCodeAgentSnapshotDigest([...a].reverse())
    );
    expect(computeCodeAgentSnapshotDigest(a)).not.toBe(
      computeCodeAgentSnapshotDigest([
        { path: "a.js", content: "a" },
        { path: "b.js", content: "bc" }
      ])
    );
  });

  it.each([
    "../x",
    "/etc/passwd",
    "a/../../x",
    "a\\x",
    "C:/x",
    ".git/config",
    "a/.git/config",
    "a//b",
    "a/./b",
    "a\u0000b"
  ])("rejects unsafe path %s", (path) => {
    expect(() => computeCodeAgentSnapshotDigest([{ path, content: "x" }])).toThrow(
      "CODE_AGENT_UNSAFE_PATH"
    );
  });

  it("rejects colliding paths, oversized input and mutable operator images", () => {
    expect(() =>
      computeCodeAgentSnapshotDigest([
        { path: "a.js", content: "" },
        { path: "A.js", content: "" }
      ])
    ).toThrow("CODE_AGENT_DUPLICATE_PATH");
    expect(() =>
      computeCodeAgentSnapshotDigest([
        { path: "a", content: "" },
        { path: "a/b", content: "" }
      ])
    ).toThrow("CODE_AGENT_PATH_CONFLICT");
    expect(() =>
      computeCodeAgentSnapshotDigest([{ path: "a", content: "x".repeat(1024 * 1024 + 1) }])
    ).toThrow("CODE_AGENT_SNAPSHOT_BYTE_LIMIT");
    expect(() =>
      createCodeAgentWorkspaceRunner({ runtime: "docker", image: "node:latest" })
    ).toThrow("CODE_AGENT_IMMUTABLE_IMAGE_REQUIRED");
  });

  it("rejects a stale approved digest before any process starts", async () => {
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: "/does-not-exist"
    });
    await expect(
      runner.run({ files, check: "node-test", expectedDigest: "f".repeat(64) })
    ).rejects.toThrow("CODE_AGENT_SNAPSHOT_CHANGED");
  });

  it("uses immutable no-network non-root OCI arguments and cleans the snapshot", async () => {
    const transport = await fixture("success");
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable
    });
    const result = await runner.run({
      files,
      check: "node-test",
      expectedDigest: computeCodeAgentSnapshotDigest(files)
    });
    expect(result.status).toBe("passed");
    expect(result.stdout).toBe("transport fixture only");
    const call = (await transport.calls())[0]!;
    for (const flag of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--user=65534:65534",
      "--pull=never",
      "--security-opt=no-new-privileges",
      "--ipc=none",
      "--log-driver=none",
      "--restart=no",
      "--pids-limit=64",
      "--memory=256m",
      "--memory-swap=256m"
    ])
      expect(call.args).toContain(flag);
    expect(call.env).not.toHaveProperty("DOCKER_HOST");
    expect(call.env).not.toHaveProperty("NODE_OPTIONS");
    expect(call.args).not.toContain("sh");
    expect(call.args).not.toContain("--mount");
    expect((await transport.calls())[1]!.args.slice(0, 2)).toEqual(["cp", "-"]);
    expect((await transport.calls())[2]!.args.slice(0, 2)).toEqual(["start", "--attach"]);
    expect(result.journal.map((entry) => entry.event)).toEqual(["snapshot", "started", "finished"]);
  });

  it("stops an output flood instead of silently declaring success", async () => {
    const transport = await fixture("flood");
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable,
      limits: { outputBytes: 256 }
    });
    const result = await runner.run({ files, check: "syntax" });
    expect(result).toMatchObject({ status: "failed", truncated: true });
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      256
    );
    expect((await transport.calls()).some((call) => call.args[0] === "rm")).toBe(true);
  });

  it("enforces deadlines and requests daemon container removal", async () => {
    const transport = await fixture("wait");
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable,
      limits: { timeoutMs: 100 }
    });
    const result = await runner.run({ files, check: "syntax" });
    expect(result.status).toBe("timed_out");
    expect((await transport.calls()).some((call) => call.args[0] === "rm")).toBe(true);
  });

  it("cancels a running process and refuses a pre-cancelled run", async () => {
    const transport = await fixture("wait");
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable
    });
    const controller = new AbortController();
    const pending = runner.run({ files, check: "node-test", signal: controller.signal });
    setTimeout(() => controller.abort(), 75);
    expect((await pending).status).toBe("cancelled");
    expect(
      (await runner.run({ files, check: "node-test", signal: controller.signal })).journal.map(
        (entry) => entry.event
      )
    ).toEqual(["snapshot", "cancelled"]);
  });

  it("fails closed when OCI is missing or cannot start a container", async () => {
    const missing = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: "/does-not-exist"
    });
    expect((await missing.run({ files, check: "syntax" })).status).toBe("unavailable");
    const transport = await fixture("unavailable");
    const unavailable = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable
    });
    expect((await unavailable.run({ files, check: "syntax" })).status).toBe("unavailable");
  });

  it("quarantines the runner after uncertain daemon cleanup and refuses further creates", async () => {
    const transport = await fixture("cleanup-fail");
    const runner = createCodeAgentWorkspaceRunner({
      runtime: "docker",
      image: IMAGE,
      executable: transport.executable,
      limits: { timeoutMs: 1_000 }
    });
    const first = await runner.run({ files, check: "syntax" });
    expect(first).toMatchObject({ status: "unavailable", cleanupVerified: false });
    expect(first.journal.some((entry) => entry.detail === "container_cleanup_unverified")).toBe(
      true
    );
    const countBefore = (await transport.calls()).length;
    const second = await runner.run({ files, check: "node-test" });
    expect(second).toMatchObject({ status: "unavailable", cleanupVerified: false });
    expect(
      second.journal.some((entry) => entry.detail === "runner_quarantined_after_unverified_cleanup")
    ).toBe(true);
    expect((await transport.calls()).length).toBe(countBefore);
    expect((await transport.calls()).filter((call) => call.args[0] === "create")).toHaveLength(1);
  });
});
