#!/usr/bin/env node
/**
 * Offline smoke verification runner for Wave 24:
 * 1. Roaring Bitmap & Positional Inverted Index (`packages/db/src/roaring-positional-inverted-index.ts`)
 * 2. Differential Privacy Telemetry & Privacy Budget Accountant (`packages/core/src/differential-privacy-telemetry.ts`)
 * 3. Petri Net Deadlock, Boundedness & Liveness Verifier (`packages/core/src/petri-net-workflow-verifier.ts`)
 * 4. Desktop RIFF/WAVE PCM Audio Synthesizer & Voice Activity Verifier (`desktop/windows/ci/wav-pcm-audio-verifier.cjs`)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-wave24-smoke-"));

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
  console.log("==> Running Desktop RIFF/WAVE PCM Audio Synthesizer & Voice Activity Verifier tests");
  const winRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/wav-pcm-audio-verifier.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> Running Roaring Bitmap Positional Index, Differential Privacy Telemetry & Petri Net Verifier tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  emitTs(
    "packages/db/src/roaring-positional-inverted-index.ts",
    "packages/db/src/roaring-positional-inverted-index.js"
  );
  emitTs(
    "packages/core/src/differential-privacy-telemetry.ts",
    "packages/core/src/differential-privacy-telemetry.js"
  );
  emitTs(
    "packages/core/src/petri-net-workflow-verifier.ts",
    "packages/core/src/petri-net-workflow-verifier.js"
  );
  emitTs(
    "apps/api/test/roaring-dp-and-petri-net.test.ts",
    "apps/api/test/roaring-dp-and-petri-net.test.js"
  );

  const apiRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "apps/api/test/roaring-dp-and-petri-net.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (apiRes.status !== 0) {
    process.exit(apiRes.status ?? 1);
  }

  console.log("[OK] All Roaring Positional Index, Differential Privacy Telemetry, Petri Net Verifier, and WAV PCM Audio Verifier checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
