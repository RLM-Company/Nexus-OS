#!/usr/bin/env node
/**
 * Offline verification runner for Wave 6 (PR #428 & PR #426 details):
 * 1. Portable Workflow JSON Import/Export Sanitizer, `WORKFLOW_TOOL_UNAVAILABLE` Pre-Check,
 *    Single-Pass Anti-Injection Parameter Binder, Plan-Only Zero-Token Default vs. Immediate Execution,
 *    and Finished Run Results ZIP STORE Exporter (PR #428)
 * 2. Fable (`claude-fable-5` via TokenShop) Model Registry Validator, Nov 9, 2026 Discovery Expiry Guard,
 *    and Secret-Free Discovery Refresher (PR #426)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave6-smoke-"));

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
  console.log("==> Running Workflow Portability, Anti-Injection Parameter Binding, ZIP Results & Fable Discovery Guard tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/workflow-portability-and-zip-exporter.ts",
    "packages/db/src/workflow-portability-and-zip-exporter.js"
  );
  emitTs(
    "apps/api/src/fable-discovery-and-registry-validator.ts",
    "apps/api/src/fable-discovery-and-registry-validator.js"
  );
  emitTs(
    "apps/api/test/workflow-portability-and-fable-discovery.test.ts",
    "apps/api/test/workflow-portability-and-fable-discovery.test.js"
  );

  const testRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/workflow-portability-and-fable-discovery.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (testRes.status !== 0) {
    process.exit(testRes.status ?? 1);
  }

  console.log("[OK] All Workflow Portability, Single-Pass Binding, ZIP Results, and Fable Discovery Guard checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
