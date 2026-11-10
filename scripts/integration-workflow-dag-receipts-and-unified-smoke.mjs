#!/usr/bin/env node
/**
 * Offline verification runner for Wave 7:
 * 1. Koswork 3 Initial Scenario Templates, Topological DAG Wave Builder, Safe Step Reorderer,
 *    Critic Output Evaluator & SQL-Immutable Version Manager (PR #428)
 * 2. Bounded 500-Receipt Context Memory Usage Store (`0059_memory_usage.sql`, PR #424)
 * 3. Unified Multi-Domain Task Coordinator across Browser Search, Desktop Focus/Hazard Check,
 *    and Workspace `.docx` Report Builder (PR #416)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave7-smoke-"));

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
  console.log("==> Running Koswork Unified Multi-Domain Task Coordinator tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/unified-task-coordinator.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Workflow DAG Templates, Critic Check, Version Immutability & Bounded Memory Receipts tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/workflow-portability-and-zip-exporter.ts",
    "packages/db/src/workflow-portability-and-zip-exporter.js"
  );
  emitTs(
    "packages/db/src/workflow-dag-templates-and-critic.ts",
    "packages/db/src/workflow-dag-templates-and-critic.js"
  );
  emitTs(
    "packages/db/src/context-memory-receipts-store.ts",
    "packages/db/src/context-memory-receipts-store.js"
  );
  emitTs(
    "apps/api/test/workflow-dag-critic-and-receipts.test.ts",
    "apps/api/test/workflow-dag-critic-and-receipts.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/workflow-dag-critic-and-receipts.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Workflow DAG Templates, Critic Verifier, Bounded Memory Receipts, and Unified Task Coordinator checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
