#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 22:
 * 1. HNSW (Hierarchical Navigable Small World) Graph Vector Index (`packages/db/src/hnsw-vector-index.ts`)
 * 2. Cryptographic Merkle State Trie & Inclusion Proof Verifier (`packages/core/src/merkle-state-trie.ts`)
 * 3. Constrained Grammar & Schema-Guided Structured Output Enforcer (`packages/core/src/constrained-grammar-enforcer.ts`)
 * 4. Multi-Monitor DPI-Aware Coordinate Calibrator & Set-of-Mark Mapper (`desktop/windows/ci/dpi-coordinate-calibrator.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave22-smoke-"));

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
  console.log("==> Running Multi-Monitor DPI-Aware Coordinate Calibrator & Set-of-Mark Mapper tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/dpi-coordinate-calibrator.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running HNSW Graph Vector Index, Merkle State Trie & Constrained Grammar Enforcer tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/context-memory-hybrid-search.ts",
    "packages/db/src/context-memory-hybrid-search.js"
  );
  emitTs(
    "packages/db/src/dense-vector-semantic-search.ts",
    "packages/db/src/dense-vector-semantic-search.js"
  );
  emitTs(
    "packages/db/src/hnsw-vector-index.ts",
    "packages/db/src/hnsw-vector-index.js"
  );
  emitTs(
    "packages/core/src/merkle-state-trie.ts",
    "packages/core/src/merkle-state-trie.js"
  );
  emitTs(
    "packages/core/src/constrained-grammar-enforcer.ts",
    "packages/core/src/constrained-grammar-enforcer.js"
  );
  emitTs(
    "apps/api/test/hnsw-merkle-and-grammar-enforcer.test.ts",
    "apps/api/test/hnsw-merkle-and-grammar-enforcer.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/hnsw-merkle-and-grammar-enforcer.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All HNSW Vector Index, Merkle State Trie, Constrained Grammar Enforcer, and DPI Calibrator checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
