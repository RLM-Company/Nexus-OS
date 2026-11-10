#!/usr/bin/env node
/**
 * Offline verification runner for:
 * 1. Local Vault PDF & Office (.pdf, .docx, .xlsx, .pptx) extractor + addressable 12k-char chunk reader
 * 2. Addressable large memory snapshot reader (up to 1000 records / 4 MiB) + server conflict-resolving restore
 * 3. CI remediation helper for PR #420 (Windows build.files) and PR #424 (context-memory.spec.ts 409 cleanup)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";
import {
  remediateContextMemoryE2eSpec,
  remediateWindowsDesktopPackagePolicy
} from "./remediate-memory-and-vault-ci.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-vault-mem-smoke-"));

function emitTs(sourceRel, targetRel) {
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
  // 1. Run Local Vault PDF/Office extractor & addressable chunk tests
  const vaultTestRes = spawnSync(
    process.execPath,
    ["--test", resolve(root, "desktop/windows/test/vault-document-extractor.test.cjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (vaultTestRes.status !== 0) {
    process.exit(vaultTestRes.status ?? 1);
  }

  // 2. Transpile and run Memory Snapshot Reconciler & Conflict Restore tests
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");
  emitTs("apps/api/src/memory-snapshot-reconciler.ts", "src/memory-snapshot-reconciler.js");
  emitTs("apps/api/test/memory-snapshot-reconciler.test.ts", "test/memory-snapshot-reconciler.test.js");

  const memTestRes = spawnSync(
    process.execPath,
    ["--test", join(temp, "test/memory-snapshot-reconciler.test.js")],
    { cwd: root, stdio: "inherit" }
  );
  if (memTestRes.status !== 0) {
    process.exit(memTestRes.status ?? 1);
  }

  // 3. Verify CI remediation helpers on a synthetic repo layout
  const fakeRepo = join(temp, "fake-repo");
  mkdirSync(join(fakeRepo, "desktop/windows"), { recursive: true });
  mkdirSync(join(fakeRepo, "apps/web/e2e"), { recursive: true });
  writeFileSync(
    join(fakeRepo, "desktop/windows/package.json"),
    JSON.stringify({
      scripts: { check: "node --check main.cjs && node --test test/*.test.cjs" },
      build: { files: ["main.cjs"] }
    }),
    "utf8"
  );
  writeFileSync(join(fakeRepo, "desktop/windows/local-vault.cjs"), "'use strict';\n", "utf8");
  writeFileSync(join(fakeRepo, "desktop/windows/vault-document-extractor.cjs"), "'use strict';\n", "utf8");
  writeFileSync(
    join(fakeRepo, "apps/web/e2e/context-memory.spec.ts"),
    `import { test, expect } from "@playwright/test";\ntest("retains the draft on concurrent record edits", async ({ page }) => {});\n`,
    "utf8"
  );

  const winPatch = remediateWindowsDesktopPackagePolicy(fakeRepo);
  assert.equal(winPatch.updated, true);
  assert.ok(winPatch.files.includes("local-vault.cjs"));
  assert.ok(winPatch.files.includes("vault-document-extractor.cjs"));

  const e2ePatch = remediateContextMemoryE2eSpec(fakeRepo);
  assert.equal(e2ePatch.updated, true);
  const patchedSpec = readFileSync(join(fakeRepo, "apps/web/e2e/context-memory.spec.ts"), "utf8");
  assert.match(patchedSpec, /resetOwnerMemoryFixture/);

  process.stdout.write("[OK] All Local Vault PDF/Office, Snapshot Restore, and CI Remediation checks passed.\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
