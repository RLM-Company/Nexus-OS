#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Google Drive Immutable Archive Spooler, Transient Retry Policy, Quota Pruner & Restore into New Chat
 * 2. Koswork Browser Shadow DOM & Same-Origin Iframe Piercer + Local Word (.docx) Report Builder
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-spool-koswork-smoke-"));

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
  console.log("==> Running Koswork Shadow DOM Piercer & Word (.docx) Report Builder tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/shadow-piercer-and-word-report.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Google Drive Immutable Spooler, Retry & New-Chat Restore tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs(
    "apps/api/src/cloud-storage/google-drive-immutable-spooler.ts",
    "apps/api/src/cloud-storage/google-drive-immutable-spooler.js"
  );
  emitTs(
    "apps/api/test/google-drive-immutable-spooler.test.ts",
    "apps/api/test/google-drive-immutable-spooler.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/google-drive-immutable-spooler.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Google Drive Immutable Spooler, New-Chat Restore, Shadow DOM Piercer, and Word (.docx) Report Builder checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
