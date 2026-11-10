#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 25:
 * 1. Partitioned Bloom Filter & Dynamic Cuckoo Filter (`packages/db/src/cuckoo-and-bloom-filter-index.ts`)
 * 2. Shamir (k, n) Threshold Secret Sharing over GF(256) (`packages/core/src/shamir-secret-sharing-escrow.ts`)
 * 3. Structural Causal Model (SCM) Do-Calculus & Counterfactual Attribution (`packages/core/src/causal-counterfactual-attribution.ts`)
 * 4. Interactive HTML5/SVG/LaTeX Report Bundle Builder (`desktop/windows/workspace/interactive-report-bundle-builder.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave25-smoke-"));

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
  console.log("==> Running Interactive HTML5/SVG/LaTeX Report Bundle Builder tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/interactive-report-bundle-builder.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Cuckoo/Bloom Filter Index, Shamir (k,n) Secret Sharing & Causal Counterfactual Attribution tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/cuckoo-and-bloom-filter-index.ts",
    "packages/db/src/cuckoo-and-bloom-filter-index.js"
  );
  emitTs(
    "packages/core/src/shamir-secret-sharing-escrow.ts",
    "packages/core/src/shamir-secret-sharing-escrow.js"
  );
  emitTs(
    "packages/core/src/causal-counterfactual-attribution.ts",
    "packages/core/src/causal-counterfactual-attribution.js"
  );
  emitTs(
    "apps/api/test/cuckoo-shamir-and-causal-engine.test.ts",
    "apps/api/test/cuckoo-shamir-and-causal-engine.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/cuckoo-shamir-and-causal-engine.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Cuckoo/Bloom Filter Index, Shamir Secret Sharing, Causal Counterfactual Attribution, and Interactive HTML Report Bundle checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
