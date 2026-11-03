#!/usr/bin/env node
/**
 * Offline verification runner for Wave 10:
 * 1. Desktop Runtime Security Watchdog (`desktop/windows/ci/desktop-runtime-watchdog.cjs`)
 * 2. Self-Healing Work DAG Runtime with Checkpoints (`packages/db/src/self-healing-workflow-runtime.ts`)
 * 3. Local Multi-Document Cross-Citation Graph & Contradiction Detector (`packages/db/src/vault-cross-citation-graph.ts`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave10-smoke-"));

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
  console.log("==> Running Desktop Runtime Watchdog tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/desktop-runtime-watchdog.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Self-Healing Workflow Runtime & Vault Cross-Citation Graph tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/context-memory-hybrid-search.ts",
    "packages/db/src/context-memory-hybrid-search.js"
  );
  emitTs(
    "packages/db/src/workflow-portability-and-zip-exporter.ts",
    "packages/db/src/workflow-portability-and-zip-exporter.js"
  );
  emitTs(
    "packages/db/src/workflow-dag-templates-and-critic.ts",
    "packages/db/src/workflow-dag-templates-and-critic.js"
  );
  emitTs(
    "packages/db/src/self-healing-workflow-runtime.ts",
    "packages/db/src/self-healing-workflow-runtime.js"
  );
  emitTs(
    "packages/db/src/vault-cross-citation-graph.ts",
    "packages/db/src/vault-cross-citation-graph.js"
  );
  emitTs(
    "apps/api/test/self-healing-runtime-and-citation-graph.test.ts",
    "apps/api/test/self-healing-runtime-and-citation-graph.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/self-healing-runtime-and-citation-graph.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Self-Healing Runtime, Cross-Citation Knowledge Graph, and Desktop Watchdog checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
