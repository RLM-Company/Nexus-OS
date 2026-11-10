#!/usr/bin/env node
/**
 * End-to-End Verification Runner for `gemini/koswork-browser-research`:
 * 1. Runs `desktop/windows/test/browser-research-acceptance.test.cjs` (5-site synthetic & real HTTP corpus,
 *    UTF-16 offsets, long/dynamic pages, post-observation text substitution, form/file/download,
 *    CAPTCHA/login user pause & resume, manual takeover invalidation, and RAM/latency benchmark).
 * 2. Transpiles and runs `apps/api/test/browser-research-store-and-routes.test.ts` (testing SQLite
 *    migration `0064_koswork_browser_research.sql`, `KosworkBrowserResearchSessionStore`,
 *    `koswork-browser-research.ts` contracts, and `browser-research-routes.ts`).
 * 3. Verifies zero modifications to Codex-reserved files and runs `scripts/check-secrets.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "koswork-browser-research-smoke-"));

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
  console.log("==> [1/4] Running Koswork Browser Research Desktop Acceptance Suite (5-site corpus + HTTP + forms + benchmark)");
  const desktopRes = spawnSync(
    process.execPath,
    [
      "--test",
      resolve(root, "desktop/windows/test/browser-research-acceptance.test.cjs"),
      resolve(root, "desktop/windows/test/download-verifier.test.cjs"),
      resolve(root, "desktop/windows/test/shadow-piercer-and-word-report.test.cjs"),
      resolve(root, "desktop/windows/test/visual-dom-diff-verifier.test.cjs"),
      resolve(root, "desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs"),
      resolve(root, "desktop/windows/test/unified-task-coordinator.test.cjs")
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (desktopRes.status !== 0) {
    process.exit(desktopRes.status ?? 1);
  }

  console.log("==> [2/4] Running SQLite Migration 0064, Contracts, Session Store & API Routes Suite");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs(
    "packages/contracts/src/koswork-browser-research.ts",
    "packages/contracts/src/koswork-browser-research.js"
  );
  emitTs(
    "packages/db/src/browser-research-session-store.ts",
    "packages/db/src/browser-research-session-store.js"
  );
  emitTs(
    "apps/api/src/browser-research-routes.ts",
    "apps/api/src/browser-research-routes.js"
  );
  emitTs(
    "apps/api/test/browser-research-store-and-routes.test.ts",
    "apps/api/test/browser-research-store-and-routes.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/browser-research-store-and-routes.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("==> [3/4] Verifying zero modifications to Codex-owned boundary files");
  const diffCheck = spawnSync(
    "git",
    [
      "diff",
      "--name-only",
      "apps/api/src/account-settings",
      "packages/db/src/usage-store.ts",
      "packages/contracts/src/usage.ts"
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(
    diffCheck.stdout.trim(),
    "",
    `Restricted boundary files must remain unmodified, found: ${diffCheck.stdout}`
  );

  console.log("==> [4/4] Running secret scan");
  const secretRes = spawnSync(
    process.execPath,
    [resolve(root, "scripts/check-secrets.mjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (secretRes.status !== 0) {
    process.exit(secretRes.status ?? 1);
  }

  console.log("[OK] All Koswork Browser Research desktop, HTTP corpus, SQLite store, API contract, and boundary checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
