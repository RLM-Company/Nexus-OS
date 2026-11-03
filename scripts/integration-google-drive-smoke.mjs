#!/usr/bin/env node
/**
 * Deterministic end-to-end integration smoke & unit test runner for the Google Drive
 * OAuth controller, shared GoogleDriveBackups privacy quiesce, multipart backup set assembly,
 * and transactional restore with fresh IDs.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-gdrive-smoke-"));

function emit(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  // Map node:sqlite import to offline-typescript.mjs DatabaseSync so it works on both Node 18 and Node 22/24
  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);

  const outPath = join(temp, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  const sources = [
    ["apps/api/src/account-settings/privacy/archive.ts", "src/account-settings/privacy/archive.js"],
    ["apps/api/src/account-settings/privacy/coordinator.ts", "src/account-settings/privacy/coordinator.js"],
    ["apps/api/src/cloud-storage/google-drive.ts", "src/cloud-storage/google-drive.js"],
    ["apps/api/src/cloud-storage/google-drive-authorization.ts", "src/cloud-storage/google-drive-authorization.js"],
    ["apps/api/src/cloud-storage/google-drive-grant-cipher.ts", "src/cloud-storage/google-drive-grant-cipher.js"],
    ["apps/api/src/cloud-storage/google-drive-store.ts", "src/cloud-storage/google-drive-store.js"],
    ["apps/api/src/cloud-storage/google-drive-backups.ts", "src/cloud-storage/google-drive-backups.js"],
    ["apps/api/src/cloud-storage/google-drive-privacy.ts", "src/cloud-storage/google-drive-privacy.js"],
    ["apps/api/src/cloud-storage/google-drive-archive-builder.ts", "src/cloud-storage/google-drive-archive-builder.js"],
    ["apps/api/src/cloud-storage/google-drive-restore.ts", "src/cloud-storage/google-drive-restore.js"],
    ["apps/api/src/cloud-storage/google-drive-controller.ts", "src/cloud-storage/google-drive-controller.js"],
    ["apps/api/src/cloud-storage/google-drive-routes.ts", "src/cloud-storage/google-drive-routes.js"],
    ["apps/api/src/cloud-storage/index.ts", "src/cloud-storage/index.js"],
    ["apps/api/test/google-drive-complete.test.ts", "test/google-drive-complete.test.js"]
  ];

  for (const [src, dst] of sources) {
    emit(src, dst);
  }

  const testFile = join(temp, "test/google-drive-complete.test.js");
  const res = spawnSync(process.execPath, ["--test", testFile], {
    cwd: root,
    stdio: "inherit"
  });
  if (res.status !== 0) {
    process.exitCode = res.status ?? 1;
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
