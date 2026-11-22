#!/usr/bin/env node
/**
 * Deterministic LOCAL simulation of the first DeepSeek report for package B.
 * NOT a live DeepSeek run: executes the real verifier against the fixture report
 * and writes a structured first-run artifact so the adaptation format is
 * exercised end to end. A real external report must replace it later.
 *
 * Usage: node first-deepseek-run.mjs [--dir <package dir>]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(
  process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : here
);
const node = process.execPath;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
const reportFile = join(dir, "reports", "deepseek-first-run.json");

let ok = true;
let output = "";
try {
  output = execFileSync(node, [join(dir, "verify.mjs"), "--report", reportFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
} catch (error) {
  ok = false;
  output = String(error.stdout ?? error.message).trim();
}

const result = {
  format: "kosmora.koswork-acceptance.first-run.v1",
  source: "local-simulation-NOT-live-DeepSeek",
  note: "Симулятор первого прогона: реальный локальный верификатор пакета, без живой модели.",
  expected_sha256: sha256(readFileSync(join(dir, "expected.json"))),
  report_sha256: sha256(readFileSync(reportFile)),
  scenarios: Object.keys(expected.scenarios),
  derived_total: expected.derived.total_amount,
  verifier_ok: ok,
  verifier_output: JSON.parse(output || "{}")
};

const outDir = join(dir, "first-deepseek-run");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
writeFileSync(
  join(outDir, "diff.md"),
  [
    "# Локальный первый прогон (НЕ живой DeepSeek)",
    "",
    "Источник: `local-simulation-NOT-live-DeepSeek`. Живая модель не вызывалась;",
    "результат получен из реального локального верификатора `verify.mjs`.",
    "",
    `- верификатор: ${ok ? "passed" : "FAILED"}`,
    `- расхождения с эталонами: ${ok ? "не обнаружены" : output}`,
    "",
    "Для живого прогона замените `reports/deepseek-first-run.json` фактическим",
    "отчётом DeepSeek и повторите `node verify.mjs --report <file>`.",
    ""
  ].join("\n"),
  "utf8"
);
console.log(
  JSON.stringify({ first_run: "local-simulation", verifier_ok: ok, out: outDir }, null, 2)
);
process.exit(ok ? 0 : 1);
