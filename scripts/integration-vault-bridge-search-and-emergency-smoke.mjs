#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Surrogate-Safe `.kosmora-vault/<SHA256>/<offset>` Virtual Reader + Binary Office/PDF Indexing + Grant Preservation (PR #421)
 * 2. Paginated First-Party Search Journal + Query-Free Navigation URLs + Persistent Bookmarks + 3-View Telemetry (PR #415)
 * 3. Full-Account Emergency Snapshot Builder & Atomic Restorer over Canonical ZIP STORE (PR #425)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave4-smoke-"));

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
  console.log("==> Running Virtual Vault Bridge, Surrogate-Safe Slicing & Paginated Browser Search tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/vault-bridge-and-search-store.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Full-Account Emergency Snapshot (Canonical ZIP STORE) tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs(
    "apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts",
    "apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.js"
  );
  emitTs(
    "apps/api/src/cloud-storage/full-account-emergency-snapshot.ts",
    "apps/api/src/cloud-storage/full-account-emergency-snapshot.js"
  );
  emitTs(
    "apps/api/test/full-account-emergency-snapshot.test.ts",
    "apps/api/test/full-account-emergency-snapshot.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/full-account-emergency-snapshot.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Virtual Vault Bridge, Paginated Search/Bookmarks, and Full-Account Emergency Snapshot checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
