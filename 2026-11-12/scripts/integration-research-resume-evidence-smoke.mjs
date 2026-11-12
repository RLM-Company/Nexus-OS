#!/usr/bin/env node
/**
 * Deterministic offline integration & acceptance test runner for Persistent Research Runs,
 * Step-by-Step Checkpoint Recovery, Changed-Page Detection, Owner/Project Authorization,
 * Hybrid DocumentLibrary + Canvas Export, Follow-Up Research, and ResearchIntegratedPrivacyAdapter
 * (`feature/research-resume-evidence`).
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-research-resume-smoke-"));

function emit(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);

  const outPath = join(temp, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  mkdirSync(join(temp, "desktop/windows/browser"), { recursive: true });
  cpSync(
    resolve(root, "desktop/windows/browser/search-pagination-and-bookmarks.cjs"),
    join(temp, "desktop/windows/browser/search-pagination-and-bookmarks.cjs")
  );

  const sources = [
    ["packages/db/src/cryptographic-audit-blackbox.ts", "packages/db/src/cryptographic-audit-blackbox.js"],
    ["packages/db/src/cuckoo-and-bloom-filter-index.ts", "packages/db/src/cuckoo-and-bloom-filter-index.js"],
    ["packages/db/src/roaring-positional-inverted-index.ts", "packages/db/src/roaring-positional-inverted-index.js"],
    ["apps/api/src/research/research-synthesis.ts", "apps/api/src/research/research-synthesis.js"],
    ["apps/api/src/research/research-store.ts", "apps/api/src/research/research-store.js"],
    ["apps/api/src/research/browser-research-adapter.ts", "apps/api/src/research/browser-research-adapter.js"],
    ["apps/api/src/research/research-coordinator.ts", "apps/api/src/research/research-coordinator.js"],
    ["apps/api/src/research/research-routes.ts", "apps/api/src/research/research-routes.js"],
    ["apps/api/src/research/research-privacy-adapter.ts", "apps/api/src/research/research-privacy-adapter.js"],
    ["apps/api/src/research/index.ts", "apps/api/src/research/index.js"],
    ["apps/web/src/app/research-workspace/view-model.ts", "apps/web/src/app/research-workspace/view-model.js"],
    ["apps/api/test/research-resume-evidence.test.ts", "apps/api/test/research-resume-evidence.test.js"]
  ];

  for (const [src, dst] of sources) {
    emit(src, dst);
  }

  const testFile = join(temp, "apps/api/test/research-resume-evidence.test.js");
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
