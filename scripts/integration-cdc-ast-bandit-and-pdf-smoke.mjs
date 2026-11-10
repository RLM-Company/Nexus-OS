#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 21:
 * 1. Rolling-Hash Content-Defined Chunking (CDC) & Sub-File Deduplication Engine (`packages/db/src/cdc-chunking-deduplicator.ts`)
 * 2. AST-Level Code & Script Sandbox Security Verifier (`packages/core/src/ast-code-sandbox-verifier.ts`)
 * 3. Bayesian Thompson Sampling Multi-Armed Bandit Strategy Router (`packages/core/src/thompson-sampling-bandit-router.ts`)
 * 4. Zero-Dependency Native PDF 1.4 Report Builder (`desktop/windows/workspace/pdf-report-builder.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave21-smoke-"));

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
  console.log("==> Running Zero-Dependency Native PDF 1.4 Report Builder tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/pdf-report-builder.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Rolling-Hash CDC Deduplicator, AST Code Sandbox Verifier & Thompson Sampling Bandit tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/cdc-chunking-deduplicator.ts",
    "packages/db/src/cdc-chunking-deduplicator.js"
  );
  emitTs(
    "packages/core/src/ast-code-sandbox-verifier.ts",
    "packages/core/src/ast-code-sandbox-verifier.js"
  );
  emitTs(
    "packages/core/src/thompson-sampling-bandit-router.ts",
    "packages/core/src/thompson-sampling-bandit-router.js"
  );
  emitTs(
    "apps/api/test/cdc-ast-and-bandit-router.test.ts",
    "apps/api/test/cdc-ast-and-bandit-router.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/cdc-ast-and-bandit-router.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All CDC Sub-File Deduplicator, AST Sandbox Verifier, Thompson Sampling Bandit, and PDF 1.4 Builder checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
