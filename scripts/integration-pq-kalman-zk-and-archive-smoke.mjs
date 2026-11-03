#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 26 (Milestone Suite 25/25):
 * 1. Product Quantization (PQ) 8-Subspace Vector Compressor & ADC (`packages/db/src/product-quantization-vector-codec.ts`)
 * 2. Kalman Filter & Page's CUSUM Change-Point Detector (`packages/core/src/kalman-cusum-drift-detector.ts`)
 * 3. Homomorphic Pedersen Commitments & Zero-Knowledge Verifier (`packages/core/src/zk-commitment-verifier.ts`)
 * 4. Pre-Extraction ZIP Archive Quarantine Verifier (`desktop/windows/ci/archive-quarantine-verifier.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave26-smoke-"));

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
  console.log("==> Running Pre-Extraction Archive Quarantine Guard tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/archive-quarantine-verifier.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Product Quantization (32x), Kalman-CUSUM Drift Detector & Zero-Knowledge Commitment tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/product-quantization-vector-codec.ts",
    "packages/db/src/product-quantization-vector-codec.js"
  );
  emitTs(
    "packages/core/src/kalman-cusum-drift-detector.ts",
    "packages/core/src/kalman-cusum-drift-detector.js"
  );
  emitTs(
    "packages/core/src/zk-commitment-verifier.ts",
    "packages/core/src/zk-commitment-verifier.js"
  );
  emitTs(
    "apps/api/test/pq-kalman-and-zk-verifier.test.ts",
    "apps/api/test/pq-kalman-and-zk-verifier.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/pq-kalman-and-zk-verifier.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Product Quantization (32x), Kalman-CUSUM Drift Detector, Zero-Knowledge Commitments, and Archive Quarantine checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
