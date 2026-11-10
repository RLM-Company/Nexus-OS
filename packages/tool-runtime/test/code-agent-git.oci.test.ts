import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { applyCodeAgentUnifiedDiff, renderCodeAgentUnifiedDiff } from "../src/code-agent-diff.js";
import {
  computeCodeAgentSnapshotDigest,
  createCodeAgentWorkspaceRunner
} from "../src/code-agent-workspace.js";
import { validateCodeAgentCheckResult } from "../src/code-agent-result.js";

it.skipIf(!process.env.CODE_AGENT_TEST_IMAGE)(
  "real temporary Git repository: exact multi-file patch, real failure/success/cancel and preserved source",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "coscode-git-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: directory,
        encoding: "utf8"
      });
    const snapshot = [
      { path: "src/sum.mjs", content: "export const sum = (a, b) => a - b;\n" },
      {
        path: "src/sum.test.mjs",
        content:
          "import assert from 'node:assert/strict';\nimport { sum } from './sum.mjs';\nassert.equal(sum(2, 3), 5);\n"
      }
    ];
    try {
      await mkdir(join(directory, "src"));
      for (const file of [
        ...snapshot,
        { path: "README.md", content: "Do not modify this file.\n" }
      ])
        await writeFile(join(directory, file.path), file.content);
      git("init", "-q");
      git("add", ".");
      git(
        "-c",
        "user.name=Coscode fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "fixture input"
      );
      const base = git("rev-parse", "HEAD").trim(),
        digest = computeCodeAgentSnapshotDigest(snapshot);
      const runner = createCodeAgentWorkspaceRunner({
        runtime: "docker",
        ...(process.env.CODE_AGENT_TEST_EXECUTABLE
          ? { executable: process.env.CODE_AGENT_TEST_EXECUTABLE }
          : {}),
        image: process.env.CODE_AGENT_TEST_IMAGE!,
        limits: { timeoutMs: 30_000 }
      });
      const before = validateCodeAgentCheckResult(
        await runner.run({ files: snapshot, check: "node-test", expectedDigest: digest }),
        digest
      );
      expect(before).toMatchObject({ status: "failed", exitCode: 1, cleanupVerified: true });
      const changes = snapshot.map((f) => ({
        ...f,
        before: f.content,
        content: f.path.endsWith("sum.mjs")
          ? "export const sum = (a, b) => a + b;\n"
          : f.content + "assert.equal(sum(-2, 1), -1);\n"
      }));
      const diff = renderCodeAgentUnifiedDiff(changes);
      const applied = applyCodeAgentUnifiedDiff({
        diff,
        snapshot,
        baseSha: base,
        expectedBaseSha: base,
        expectedSnapshotDigest: digest,
        existingPaths: [...snapshot.map((f) => f.path), "README.md"]
      });
      expect(applied.files.map((f) => f.path).sort()).toEqual(snapshot.map((f) => f.path).sort());
      expect(() =>
        applyCodeAgentUnifiedDiff({
          diff,
          snapshot: [{ ...snapshot[0]!, content: "changed externally\n" }, snapshot[1]!],
          baseSha: base,
          expectedBaseSha: base,
          expectedSnapshotDigest: digest
        })
      ).toThrow("PATCH_SNAPSHOT");
      const afterDigest = computeCodeAgentSnapshotDigest(applied.files);
      const after = validateCodeAgentCheckResult(
        await runner.run({ files: applied.files, check: "node-test", expectedDigest: afterDigest }),
        afterDigest
      );
      expect(after).toMatchObject({ status: "passed", exitCode: 0, cleanupVerified: true });
      execFileSync("git", ["apply", "--check", "-"], { cwd: directory, input: diff });
      execFileSync("git", ["apply", "--index", "-"], { cwd: directory, input: diff });
      expect(git("diff", "--cached", "--name-only").trim().split("\n").sort()).toEqual(
        snapshot.map((f) => f.path).sort()
      );
      expect(await readFile(join(directory, "README.md"), "utf8")).toBe(
        "Do not modify this file.\n"
      );
      for (const file of applied.files) expect(git("show", ":" + file.path)).toBe(file.content);
      const controller = new AbortController();
      const running = runner.run({
        files: [{ path: "wait.test.mjs", content: "setInterval(()=>{},1000);\n" }],
        check: "node-test",
        signal: controller.signal
      });
      const timer = setTimeout(() => controller.abort(), 1000);
      const cancelled = await running;
      clearTimeout(timer);
      expect(cancelled).toMatchObject({ status: "cancelled", cleanupVerified: true });
      if (process.env.CODE_AGENT_GIT_REPORT_DIR) {
        const out = process.env.CODE_AGENT_GIT_REPORT_DIR;
        await mkdir(out, { recursive: true });
        await writeFile(
          join(out, "receipt.json"),
          JSON.stringify(
            {
              base_sha: base,
              image: process.env.CODE_AGENT_TEST_IMAGE,
              input_snapshot_digest: digest,
              output_snapshot_digest: afterDigest,
              before,
              after,
              cancelled,
              changed_files: applied.files.map((f) => f.path),
              original_readme_preserved: true,
              real_model_called: false,
              github_published: false
            },
            null,
            2
          ) + "\n",
          { flag: "wx" }
        );
        await writeFile(join(out, "changes.patch"), git("diff", "--cached", "--binary"), {
          flag: "wx"
        });
        await writeFile(join(out, "input.json"), JSON.stringify(snapshot, null, 2) + "\n", {
          flag: "wx"
        });
        await writeFile(join(out, "output.json"), JSON.stringify(applied.files, null, 2) + "\n", {
          flag: "wx"
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  90_000
);
