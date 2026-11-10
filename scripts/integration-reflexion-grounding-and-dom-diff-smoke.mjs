#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 18:
 * 1. Episodic Experience Replay & Autonomous Reflexion Engine (`packages/db/src/episodic-reflexion-engine.ts`)
 * 2. Zero-Hallucination Citation & Claim Grounding Verifier (`packages/core/src/claim-grounding-verifier.ts`)
 * 3. Desktop Visual DOM Mutation & Action Verification Engine (`desktop/windows/browser/visual-dom-diff-verifier.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave18-smoke-"));

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
  console.log("==> Running Desktop Visual DOM Mutation & Action Verification tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/visual-dom-diff-verifier.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Episodic Reflexion Engine & Zero-Hallucination Claim Grounding Verifier tests");
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
    "packages/db/src/episodic-reflexion-engine.ts",
    "packages/db/src/episodic-reflexion-engine.js"
  );
  emitTs(
    "packages/core/src/claim-grounding-verifier.ts",
    "packages/core/src/claim-grounding-verifier.js"
  );
  emitTs(
    "apps/api/test/reflexion-and-grounding-verifier.test.ts",
    "apps/api/test/reflexion-and-grounding-verifier.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/reflexion-and-grounding-verifier.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Episodic Reflexion, Claim Grounding Verifier, and Visual DOM Diff checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
