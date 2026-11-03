#!/usr/bin/env node
/**
 * Offline verification runner for Wave 9 & 16 (Next-Gen Technologies & Advanced Frontier):
 * 1. Zero-Dependency Dense Vector Semantic Search & True Dense+Sparse RRF Hybrid Search (`packages/db/src/dense-vector-semantic-search.ts`)
 * 2. Model-Aware Prompt Caching Optimizer with 1024-Token Prefix Alignment (`packages/core/src/prompt-caching-optimizer.ts`)
 * 3. Autonomous Multi-Agent Consensus & Adversarial Verification Engine (`packages/db/src/multi-agent-consensus-engine.ts`)
 * 4. Vault Visual Perceptual Difference Hash (dHash) & DrawingML Diagram Topology Extractor (`desktop/windows/vault-visual-diagram-extractor.cjs`)
 * 5. Streaming Speculative Tool Router & Intent Detection Engine (`packages/core/src/speculative-tool-router.ts`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave9-smoke-"));

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
  console.log("==> Running Visual Difference Hash (dHash) & DrawingML Diagram Topology tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/visual-diagram-extractor.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Dense Vector Semantic Search, Prompt Caching Optimizer & Multi-Agent Consensus tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/core/src/bpe-context-estimator-and-audit.ts",
    "packages/core/src/bpe-context-estimator-and-audit.js"
  );
  emitTs(
    "packages/core/src/prompt-caching-optimizer.ts",
    "packages/core/src/prompt-caching-optimizer.js"
  );
  emitTs(
    "packages/core/src/speculative-tool-router.ts",
    "packages/core/src/speculative-tool-router.js"
  );
  emitTs(
    "packages/db/src/context-memory-hybrid-search.ts",
    "packages/db/src/context-memory-hybrid-search.js"
  );
  emitTs(
    "packages/db/src/dense-vector-semantic-search.ts",
    "packages/db/src/dense-vector-semantic-search.js"
  );
  emitTs(
    "packages/db/src/multi-agent-consensus-engine.ts",
    "packages/db/src/multi-agent-consensus-engine.js"
  );
  emitTs(
    "apps/api/test/nextgen-vector-caching-consensus.test.ts",
    "apps/api/test/nextgen-vector-caching-consensus.test.js"
  );
  emitTs(
    "apps/api/test/speculative-tool-router.test.ts",
    "apps/api/test/speculative-tool-router.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/nextgen-vector-caching-consensus.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("==> Running Streaming Speculative Tool Router & Intent Detection tests");
  const specRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/speculative-tool-router.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (specRes.status !== 0) {
    process.exit(specRes.status ?? 1);
  }

  console.log("[OK] All Dense Vector Embeddings, Prompt Caching, Multi-Agent Consensus, Visual Diagram, and Speculative Router checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
