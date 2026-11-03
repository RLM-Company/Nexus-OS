#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 19:
 * 1. Hybrid Logical Clock (HLC) & CRDT Conflict-Free Memory Sync Engine (`packages/db/src/crdt-memory-sync-engine.ts`)
 * 2. Monte Carlo Tree Search (MCTS) Lookahead DAG Planner (`packages/core/src/mcts-workflow-planner.ts`)
 * 3. Real-Time PII & Sensitive Data Redaction Firewall (`packages/core/src/pii-redaction-firewall.ts`)
 * 4. Zero-Dependency OpenXML Excel (.xlsx) & CSV Workbook Builder (`desktop/windows/workspace/excel-workbook-builder.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave19-smoke-"));

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
  console.log("==> Running OpenXML Excel (.xlsx) & CSV Workbook Builder tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/excel-workbook-builder.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running CRDT Memory Sync, MCTS Lookahead Planner & PII Redaction Firewall tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/crdt-memory-sync-engine.ts",
    "packages/db/src/crdt-memory-sync-engine.js"
  );
  emitTs(
    "packages/core/src/mcts-workflow-planner.ts",
    "packages/core/src/mcts-workflow-planner.js"
  );
  emitTs(
    "packages/core/src/pii-redaction-firewall.ts",
    "packages/core/src/pii-redaction-firewall.js"
  );
  emitTs(
    "apps/api/test/crdt-mcts-and-pii-firewall.test.ts",
    "apps/api/test/crdt-mcts-and-pii-firewall.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/crdt-mcts-and-pii-firewall.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All CRDT Memory Sync, MCTS Lookahead Planner, PII Firewall, and Excel Workbook checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
