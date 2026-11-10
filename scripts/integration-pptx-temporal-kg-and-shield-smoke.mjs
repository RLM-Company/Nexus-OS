#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 20:
 * 1. Zero-Dependency OpenXML PowerPoint (.pptx) Presentation Builder (`desktop/windows/workspace/powerpoint-deck-builder.cjs`)
 * 2. Temporal Bitemporal Knowledge Graph & Time-Travel Query Engine (`packages/db/src/temporal-knowledge-graph.ts`)
 * 3. Prompt Injection & Indirect Jailbreak Security Shield (`packages/core/src/prompt-injection-shield.ts`)
 * 4. Adaptive Circuit Breaker, EWMA Latency Tracker & Token Bucket Rate Limiter (`packages/core/src/adaptive-circuit-breaker.ts`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave20-smoke-"));

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
  console.log("==> Running OpenXML PowerPoint (.pptx) Presentation Builder tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/powerpoint-deck-builder.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Temporal Bitemporal Knowledge Graph, Prompt Injection Shield & Adaptive Circuit Breaker tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/temporal-knowledge-graph.ts",
    "packages/db/src/temporal-knowledge-graph.js"
  );
  emitTs(
    "packages/core/src/prompt-injection-shield.ts",
    "packages/core/src/prompt-injection-shield.js"
  );
  emitTs(
    "packages/core/src/adaptive-circuit-breaker.ts",
    "packages/core/src/adaptive-circuit-breaker.js"
  );
  emitTs(
    "apps/api/test/temporal-kg-injection-and-circuit-breaker.test.ts",
    "apps/api/test/temporal-kg-injection-and-circuit-breaker.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/temporal-kg-injection-and-circuit-breaker.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All PowerPoint (.pptx) Builder, Temporal Knowledge Graph, Prompt Injection Shield, and Adaptive Circuit Breaker checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
