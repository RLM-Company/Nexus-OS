#!/usr/bin/env node
/**
 * Offline verification runner for Wave 5 (PRs #426, #427, #428):
 * 1. Resilient Fable (`claude-fable-5`) SSE Stream Assembler, Truncation Guard & `<escape>JSON</escape>` Unwrapper (PR #426 / #428)
 * 2. Owner-Isolated, Version-Invalidated O(N) Context Memory Prefix Byte Cache & Mandatory Prefix Budget Enforcer (PR #427)
 * 3. Reusable Workflow Sub-Workflow Inliner (with Recursion Cycle Detection), Browser/Computer Step Consent Gate & Idempotent Scheduled Runner (PR #428)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave5-smoke-"));

function emitTs(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);
  code = code.replace(/\.ts(["'])/g, ".js$1");

  const outPath = join(temp, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

try {
  console.log("==> Running Fable SSE Resilient Stream, Memory Prefix Byte Cache & Workflow Schedule/Sub-Workflow tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "apps/api/src/fable-sse-resilient-stream.ts",
    "apps/api/src/fable-sse-resilient-stream.js"
  );
  emitTs(
    "packages/db/src/context-memory-prefix-byte-cache.ts",
    "packages/db/src/context-memory-prefix-byte-cache.js"
  );
  emitTs(
    "packages/db/src/workflow-schedule-and-subworkflow-runner.ts",
    "packages/db/src/workflow-schedule-and-subworkflow-runner.js"
  );
  emitTs(
    "apps/api/test/fable-sse-memory-cache-and-workflows.test.ts",
    "apps/api/test/fable-sse-memory-cache-and-workflows.test.js"
  );

  const testRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/fable-sse-memory-cache-and-workflows.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (testRes.status !== 0) {
    process.exit(testRes.status ?? 1);
  }

  console.log("[OK] All Fable SSE Resilient Stream, Memory Prefix Byte Cache, and Workflow Schedule/Sub-Workflow checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
