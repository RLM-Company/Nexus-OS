#!/usr/bin/env node
/**
 * Deterministic LOCAL simulation of the first Gemini run for package A.
 *
 * IMPORTANT: this is NOT a live Gemini/provider run. It executes the same local
 * checks that the package README prescribes (self-check, product importer via
 * vitest, deep analyzer via vitest) and writes their observable results into a
 * first-gemini-run/ report so the adaptation format is exercised end to end.
 * A real external report must replace it later without faking results.
 *
 * Usage: node first-gemini-run.mjs [--dir <package dir>]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(
  process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : here
);
const root = resolve(dir, "..", "..", "..", "..");
const node = process.execPath;
const bundledPnpm =
  "C:\\Users\\РђР»РµРєСЃР°РЅРґСЂ\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs";
const pnpmMjs =
  process.env.PNPM_PATH ??
  (existsSync(bundledPnpm) ? bundledPnpm : join(root, "node_modules", "pnpm", "bin", "pnpm.mjs"));
const pnpmArgs = (cwd, args) => ["-C", cwd, ...args];
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const run = (args, cwd) => {
  try {
    const stdout = execFileSync(node, [pnpmMjs, ...pnpmArgs(cwd, args)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024
    });
    return { ok: true, output: stdout.trim() };
  } catch (error) {
    return { ok: false, output: String(error.stdout ?? error.message).trim() };
  }
};

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const checks = [
  {
    name: "self-check",
    ...run(
      [
        "exec",
        "vitest",
        "run",
        "--pool=threads",
        "--maxWorkers=1",
        "src/app/studio-fixture-import.test.ts"
      ],
      join(root, "apps", "web")
    )
  },
  {
    name: "deep-analysis",
    ...run(
      [
        "exec",
        "vitest",
        "run",
        "--pool=threads",
        "--maxWorkers=1",
        "test/studio-fixture-deep-analysis.test.ts"
      ],
      join(root, "apps", "api")
    )
  }
];

const result = {
  format: "kosmora.studio-document-package.first-run.v1",
  source: "local-simulation-NOT-live-Gemini",
  note: "РЎРёРјСѓР»СЏС‚РѕСЂ РїРµСЂРІРѕРіРѕ РїСЂРѕРіРѕРЅР°: СЂРµР°Р»СЊРЅС‹Рµ Р»РѕРєР°Р»СЊРЅС‹Рµ РїСЂРѕРІРµСЂРєРё РїР°РєРµС‚Р°, Р±РµР· Р¶РёРІРѕР№ РјРѕРґРµР»Рё Рё РІРЅРµС€РЅРёС… РІС‹Р·РѕРІРѕРІ.",
  manifest_sha256: sha256(readFileSync(join(dir, "manifest.json"))),
  archives: Object.fromEntries(
    Object.entries(manifest.archives).map(([key, desc]) => [
      key,
      {
        file: desc.file,
        sha256: desc.sha256,
        expected_members: desc.members.length,
        expected_document_names: desc.expected_document_names,
        skipped: desc.skipped?.length ?? 0,
        incomplete: desc.incomplete?.length ?? 0,
        duplicates: desc.nested_expanded?.length ?? 0
      }
    ])
  ),
  checks,
  all_checks_passed: checks.every((check) => check.ok),
  observed_vs_expected: {
    citations: manifest.citations.length,
    pages: manifest.pages.length,
    question: manifest.question
  }
};

const outDir = join(dir, "first-gemini-run");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");

const diffs = [];
for (const check of checks) if (!check.ok) diffs.push(`- ${check.name}: ${check.output}`);
const diff = [
  `# Р›РѕРєР°Р»СЊРЅС‹Р№ РїРµСЂРІС‹Р№ РїСЂРѕРіРѕРЅ (РќР• Р¶РёРІРѕР№ Gemini)`,
  ``,
  `РСЃС‚РѕС‡РЅРёРє: \`local-simulation-NOT-live-Gemini\`. Р–РёРІР°СЏ РјРѕРґРµР»СЊ РЅРµ РІС‹Р·С‹РІР°Р»Р°СЃСЊ;`,
  `СЂРµР·СѓР»СЊС‚Р°С‚ РїРѕР»СѓС‡РµРЅ РёР· СЂРµР°Р»СЊРЅС‹С… Р»РѕРєР°Р»СЊРЅС‹С… РїСЂРѕРІРµСЂРѕРє РїР°РєРµС‚Р°.`,
  ``,
  `- self-check/РёРјРїРѕСЂС‚РµСЂ: ${checks[0]?.ok ? "passed" : "FAILED"}`,
  `- deep-Р°РЅР°Р»РёР·: ${checks[1]?.ok ? "passed" : "FAILED"}`,
  `- СЂР°СЃС…РѕР¶РґРµРЅРёСЏ СЃ manifest: ${diffs.length ? diffs.join("\n") : "РЅРµ РѕР±РЅР°СЂСѓР¶РµРЅС‹"}`,
  ``,
  `Р”Р»СЏ Р¶РёРІРѕРіРѕ РїСЂРѕРіРѕРЅР° Р·Р°РјРµРЅРёС‚Рµ СЌС‚РѕС‚ РєР°С‚Р°Р»РѕРі С„Р°РєС‚РёС‡РµСЃРєРёРј РѕС‚С‡С‘С‚РѕРј Gemini Рё`,
  `РїРѕРІС‚РѕСЂРёС‚Рµ СЃРІРµСЂРєСѓ РїРѕ manifest.json. РќРµ РІС‹РґР°РІР°Р№С‚Рµ СЃРёРјСѓР»СЏС‚РѕСЂ Р·Р° Р¶РёРІРѕР№ СЂРµР·СѓР»СЊС‚Р°С‚.`,
  ``
].join("\n");
writeFileSync(join(outDir, "diff.md"), diff, "utf8");

console.log(
  JSON.stringify(
    {
      first_run: "local-simulation",
      checks: checks.map((c) => ({ name: c.name, ok: c.ok })),
      all_passed: result.all_checks_passed,
      out: outDir
    },
    null,
    2
  )
);
process.exit(result.all_checks_passed ? 0 : 1);
