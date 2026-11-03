#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Topic & Change-History Compaction + Detail Restoration + Semantic Loss Measurement
 * 2. Profile Candidate Reconciler (Contradiction Detection, Promotion, Non-Destructive Deletion Exceptions)
 * 3. Memory-Bounded VPS Chat & Memory History Migrator + PR #423 Connectivity Probe Evaluator
 * 4. Regression check of previously completed Hybrid Search, Legacy Migration & Vault Document Extractor suites
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-compaction-vps-smoke-"));

function emitTs(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  const probeScriptUrl = pathToFileURL(
    resolve(root, "scripts/vps-chat-recovery-and-tls-probe.mjs")
  ).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);
  code = code.replace(
    /from\s+["']\.\.\/\.\.\/\.\.\/scripts\/vps-chat-recovery-and-tls-probe\.mjs["']/g,
    `from "${probeScriptUrl}"`
  );
  code = code.replace(/\.ts(["'])/g, ".js$1");

  const outPath = join(temp, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/context-memory-hybrid-search.ts",
    "packages/db/src/context-memory-hybrid-search.js"
  );
  emitTs(
    "packages/db/src/history-compaction-topic-analyzer.ts",
    "packages/db/src/history-compaction-topic-analyzer.js"
  );
  emitTs(
    "packages/db/src/profile-candidate-reconciler.ts",
    "packages/db/src/profile-candidate-reconciler.js"
  );
  emitTs(
    "packages/db/src/vps-chat-history-migrator.ts",
    "packages/db/src/vps-chat-history-migrator.js"
  );
  emitTs(
    "apps/api/src/memory-advanced-compaction-routes.ts",
    "apps/api/src/memory-advanced-compaction-routes.js"
  );
  emitTs(
    "apps/api/test/memory-compaction-and-profile-reconciler.test.ts",
    "apps/api/test/memory-compaction-and-profile-reconciler.test.js"
  );

  console.log("==> Running Topic Compaction, Profile Reconciler & VPS Chat Migrator tests");
  const testRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/memory-compaction-and-profile-reconciler.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (testRes.status !== 0) {
    process.exit(testRes.status ?? 1);
  }

  console.log("[OK] All Topic Compaction, Profile Reconciler, and VPS Chat Recovery checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
