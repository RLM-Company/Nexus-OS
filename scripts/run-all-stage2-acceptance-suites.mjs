#!/usr/bin/env node
/**
 * Master Stage-2 Acceptance & Privacy/IPC Verification Runner:
 * 1. Verifies that restricted Codex files (`apps/api/src/account-settings/**`, `packages/db/src/usage-store.ts`,
 *    `packages/contracts/src/usage.ts`) have zero modifications.
 * 2. Runs `desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs`
 * 3. Runs `apps/api/test/stage2-privacy-and-fencing.test.ts` (testing `0063_unified_stage2_extensions.sql`
 *    triggers and `createStage2PrivacyAdapter`).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave8-smoke-"));

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
  console.log("==> Running Stage-2 Desktop IPC Bridge security & routing tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/stage2-desktop-ipc-bridge.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Stage-2 Migration 0063, OWNER_DATA_FENCED triggers & PrivacyAdapter tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs("apps/api/src/stage2-privacy-adapter.ts", "apps/api/src/stage2-privacy-adapter.js");
  emitTs(
    "apps/api/test/stage2-privacy-and-fencing.test.ts",
    "apps/api/test/stage2-privacy-and-fencing.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/stage2-privacy-and-fencing.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  // Verify restricted boundary files are untouched
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

  console.log("[OK] All Stage-2 Migration 0063, Privacy Fence Triggers, Desktop IPC Bridge, and Boundary checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
