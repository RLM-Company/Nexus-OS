#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 23:
 * 1. Deductive Datalog & Forward-Chaining Policy Inference Engine (`packages/core/src/datalog-inference-engine.ts`)
 * 2. MinHash & Locality-Sensitive Hashing (LSH) Near-Duplicate Detector (`packages/db/src/minhash-lsh-deduplicator.ts`)
 * 3. W3C OpenTelemetry Distributed Trace & Critical-Path Waterfall Analyzer (`packages/core/src/opentelemetry-trace-analyzer.ts`)
 * 4. Windows Clipboard Pastejacking & Drag-and-Drop Sandbox Guard (`desktop/windows/ci/clipboard-and-drop-guard.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave23-smoke-"));

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
  console.log("==> Running Windows Clipboard Pastejacking & Drag-and-Drop Sandbox Guard tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/clipboard-and-drop-guard.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Deductive Datalog Engine, MinHash-LSH Deduplicator & OpenTelemetry Trace Analyzer tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/core/src/datalog-inference-engine.ts",
    "packages/core/src/datalog-inference-engine.js"
  );
  emitTs(
    "packages/db/src/minhash-lsh-deduplicator.ts",
    "packages/db/src/minhash-lsh-deduplicator.js"
  );
  emitTs(
    "packages/core/src/opentelemetry-trace-analyzer.ts",
    "packages/core/src/opentelemetry-trace-analyzer.js"
  );
  emitTs(
    "apps/api/test/datalog-minhash-and-otel-tracer.test.ts",
    "apps/api/test/datalog-minhash-and-otel-tracer.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/datalog-minhash-and-otel-tracer.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Datalog Inference Engine, MinHash-LSH Deduplicator, OpenTelemetry Tracer, and Clipboard Guard checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
