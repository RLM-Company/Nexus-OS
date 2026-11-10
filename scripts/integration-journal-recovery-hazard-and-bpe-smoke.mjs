#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Google Drive Journal-Loss Catalog Recovery & External/Picker Canonical ZIP STORE Importer (PR #425 update `3579bc9`)
 * 2. Calibrated Cyrillic/Code/Image-Tile BPE Token Estimator & Provider Authenticity Auditor (PR #422)
 * 3. Koswork Windows Computer Control Hazard Classifier, Focus-Loss Guard & Fresh-Consent Recovery (PR #411 / #412)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-journal-hazard-smoke-"));

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
  console.log("==> Running Koswork Computer Hazard Classifier, Focus-Loss Guard & Fresh-Consent Recovery tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/computer-hazard-and-focus-guard.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Google Drive Journal-Loss Recovery, Canonical ZIP STORE Importer & Calibrated BPE Auditor tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs(
    "packages/core/src/bpe-context-estimator-and-audit.ts",
    "packages/core/src/bpe-context-estimator-and-audit.js"
  );
  emitTs(
    "apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.ts",
    "apps/api/src/cloud-storage/google-drive-journal-recovery-and-zip-import.js"
  );
  emitTs(
    "apps/api/test/drive-journal-recovery-and-bpe-audit.test.ts",
    "apps/api/test/drive-journal-recovery-and-bpe-audit.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/drive-journal-recovery-and-bpe-audit.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Drive Journal-Loss Recovery, External ZIP STORE Import, Calibrated BPE Estimator, and Computer Hazard/Focus Guard checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
