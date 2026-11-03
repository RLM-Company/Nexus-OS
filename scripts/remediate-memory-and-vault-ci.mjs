#!/usr/bin/env node
/**
 * Idempotent CI & Packaging Remediation Helper for:
 * 1. PR #420 (`codex/koswork-local-vault-20261031` — Windows desktop NSIS build.files & syntax check registration)
 * 2. PR #424 (`codex/koswork-memory-usage-20261031` — `apps/web/e2e/context-memory.spec.ts` HTTP 409 Conflict across sequential tests/retries on port 3226)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function remediateWindowsDesktopPackagePolicy(repoRoot = root) {
  const pkgPath = resolve(repoRoot, "desktop/windows/package.json");
  if (!existsSync(pkgPath)) return { updated: false };
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  let changed = false;

  const optionalDesktopModules = [
    "vault-document-extractor.cjs",
    "local-vault.cjs",
    "test/vault-console.cjs",
    "test/vault-preload.cjs",
    "test/vault.css",
    "test/vault.html",
    "test/vault.js"
  ];

  for (const relFile of optionalDesktopModules) {
    const absFile = resolve(repoRoot, "desktop/windows", relFile);
    if (existsSync(absFile)) {
      if (Array.isArray(pkg.build?.files) && !pkg.build.files.includes(relFile)) {
        pkg.build.files.push(relFile);
        changed = true;
      }
      if (
        relFile.endsWith(".cjs") &&
        typeof pkg.scripts?.check === "string" &&
        !pkg.scripts.check.includes(`node --check ${relFile}`)
      ) {
        pkg.scripts.check = pkg.scripts.check.replace(
          "node --test test/*.test.cjs",
          `node --check ${relFile} && node --test test/*.test.cjs`
        );
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }
  return { updated: changed, files: pkg.build?.files ?? [] };
}

export function remediateContextMemoryE2eSpec(repoRoot = root) {
  const specPath = resolve(repoRoot, "apps/web/e2e/context-memory.spec.ts");
  if (!existsSync(specPath)) return { updated: false, reason: "spec_not_present_on_branch" };

  let content = readFileSync(specPath, "utf8");
  let changed = false;

  // Ensure sequential tests and Playwright retries on the shared port 3226 fixture
  // drain any active run and delete prior test-created records before seeding new ones,
  // preventing HTTP 409 Conflict on `expect(created.status()).toBe(201)` and `expect(saved.status()).toBe(201)`.
  const cleanupHelper = `
async function resetOwnerMemoryFixture(request: import("@playwright/test").APIRequestContext) {
  const existing = await request.get("/api/v1/context-memory");
  if (!existing.ok()) return;
  const body = (await existing.json()) as {
    items?: Array<{ id: string; version?: number }>;
    records?: Array<{ id: string; version?: number }>;
  };
  const list = body.items ?? body.records ?? [];
  for (const item of list) {
    await request.delete(\`/api/v1/context-memory/\${encodeURIComponent(item.id)}\`).catch(() => {});
  }
}
`;

  if (!content.includes("resetOwnerMemoryFixture")) {
    content = cleanupHelper.trimStart() + "\n" + content;
    changed = true;
  }

  if (
    content.includes("test.beforeEach(async (") &&
    !content.includes("await resetOwnerMemoryFixture(")
  ) {
    content = content.replace(
      /test\.beforeEach\(async\s*\(\{\s*([^}]*)\}\)\s*=>\s*\{/,
      (match, args) => {
        const hasRequest = /\brequest\b/.test(args);
        const newArgs = hasRequest ? args : `${args.trim()}, request `;
        return `test.beforeEach(async ({ ${newArgs}}) => {\n  await resetOwnerMemoryFixture(request);`;
      }
    );
    changed = true;
  } else if (!content.includes("test.beforeEach(")) {
    content = content.replace(
      /(test\s*\(\s*["']retains the draft on concurrent record edits)/,
      `test.beforeEach(async ({ request }) => {\n  await resetOwnerMemoryFixture(request);\n});\n\n$1`
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(specPath, content, "utf8");
  }
  return { updated: changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const winRes = remediateWindowsDesktopPackagePolicy(root);
  const e2eRes = remediateContextMemoryE2eSpec(root);
  process.stdout.write(
    JSON.stringify({ windowsPackageUpdated: winRes.updated, contextMemoryE2eUpdated: e2eRes.updated }) + "\n"
  );
}
