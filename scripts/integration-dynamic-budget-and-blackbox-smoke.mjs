#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 17:
 * 1. Adaptive Context Pruning & Dynamic Attention Budget Allocator (`packages/core/src/dynamic-context-budget-allocator.ts`)
 * 2. Deterministic Cryptographic Audit Trail & Tamper-Proof Session Blackbox (`packages/db/src/cryptographic-audit-blackbox.ts`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave17-smoke-"));

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
  console.log("==> Running Dynamic Context Budget Allocator & Cryptographic Audit Blackbox tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/core/src/bpe-context-estimator-and-audit.ts",
    "packages/core/src/bpe-context-estimator-and-audit.js"
  );
  emitTs(
    "packages/core/src/dynamic-context-budget-allocator.ts",
    "packages/core/src/dynamic-context-budget-allocator.js"
  );
  emitTs(
    "packages/db/src/cryptographic-audit-blackbox.ts",
    "packages/db/src/cryptographic-audit-blackbox.js"
  );
  emitTs(
    "apps/api/test/dynamic-budget-and-audit-blackbox.test.ts",
    "apps/api/test/dynamic-budget-and-audit-blackbox.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/dynamic-budget-and-audit-blackbox.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Dynamic Budget Allocation, Knapsack Optimization, and Audit Blackbox checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
