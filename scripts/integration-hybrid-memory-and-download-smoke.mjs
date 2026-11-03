#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Windows Native Browser Download Verifier (`desktop/windows/browser/download-verifier.cjs`)
 * 2. Context Memory Hybrid Search & Entity Extraction (`packages/db/src/context-memory-hybrid-search.ts`)
 * 3. Legacy Project Memory & Notes Migration + Temporary Chat Mode (`packages/db/src/context-memory-notes-migrator.ts`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-hybrid-mem-smoke-"));

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
  console.log("==> Running Windows Native Browser Download Verifier tests");
  const dlTestRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/download-verifier.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (dlTestRes.status !== 0) {
    process.exit(dlTestRes.status ?? 1);
  }

  console.log("==> Running Context Memory Hybrid Search, Entity Extraction & Legacy Migration tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs("packages/db/src/context-memory-hybrid-search.ts", "packages/db/src/context-memory-hybrid-search.js");
  emitTs("packages/db/src/context-memory-notes-migrator.ts", "packages/db/src/context-memory-notes-migrator.js");
  emitTs("apps/api/src/context-memory-hybrid-routes.ts", "apps/api/src/context-memory-hybrid-routes.js");
  emitTs("apps/api/test/context-memory-hybrid-and-migration.test.ts", "apps/api/test/context-memory-hybrid-and-migration.test.js");

  const memTestRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/context-memory-hybrid-and-migration.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (memTestRes.status !== 0) {
    process.exit(memTestRes.status ?? 1);
  }

  console.log("[OK] All Hybrid Recall, Legacy Notes Migration, Temporary Mode, and Windows Download Verifier checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
