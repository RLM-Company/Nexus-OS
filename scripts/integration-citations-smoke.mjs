#!/usr/bin/env node
import { ts } from "./offline-typescript.mjs";
/** Actual document citation attestation and research evidence parsing, no model dispatch. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const temp = mkdtempSync(join(tmpdir(), "kosmora-citations-"));
const repo = resolve(import.meta.dirname, "..");
try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}');
  const research = ts.transpileModule(
    readFileSync(join(repo, "packages/core/src/research/index.ts"), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText;
  writeFileSync(join(temp, "research.js"), research);
  let document = ts.transpileModule(
    readFileSync(join(repo, "apps/api/src/document-answer-service.ts"), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText;
  document = document.replace(/^import .*?;\n/gm, "");
  writeFileSync(join(temp, "document.js"), document);
  const { parseResearchAnswer, researchEvidence, researchMarkdown } = await import(
    pathToFileURL(join(temp, "research.js"))
  );
  const { validateDocumentAnswer } = await import(pathToFileURL(join(temp, "document.js")));
  const source = {
    ref: "S1",
    chunk_id: 1,
    file_id: "file-1",
    name: "source.txt",
    page: null,
    line_start: 1,
    line_end: 3,
    content: "Точная цитата о научном исследовании и полном контексте."
  };
  const ok = validateDocumentAnswer("Вывод: «Точная цитата о научном исследовании» [S1]", [source]);
  assert.equal(ok.verifiedQuotes, 1);
  assert.deepEqual(ok.citations, ["S1"]);
  assert(ok.answer.includes("Дословно в источнике"));
  assert.throws(
    () => validateDocumentAnswer("«Невозможный выдуманный факт» [S1]", [source]),
    /NO_VERIFIED_QUOTATIONS/
  );
  assert.throws(
    () => validateDocumentAnswer("«Точная цитата о научном исследовании» [S99]", [source]),
    /INVALID_CITATION/
  );
  assert.throws(
    () => validateDocumentAnswer("«Точная цитата о научном исследовании» [S1] [S2]", [source]),
    /INVALID_CITATION/
  );
  console.log(
    "PASS documents: literal quote attestation and unknown/fabricated citation rejection"
  );
  const run = {
    id: "run",
    question: "Исследование",
    status: "completed",
    created_at: "2026-10-09",
    updated_at: "2026-10-09",
    candidates: [],
    sources: [
      {
        title: "Источник",
        url: "https://example.com/",
        snippet: "",
        status: "read",
        passages: ["Это действительная выдержка из прочитанного источника."],
        checked_at: "2026-10-09"
      }
    ]
  };
  assert.equal(researchEvidence(run).length, 1);
  const answer = parseResearchAnswer(
    JSON.stringify({
      summary: [{ text: "Проверяемый тезис", citations: [{ source_id: "S1", excerpt_id: "E1" }] }],
      disagreements: [],
      gaps: ["Не установлены остальные детали"]
    }),
    run
  );
  assert.equal(answer.summary[0].citations[0].excerpt_id, "E1");
  assert.throws(
    () =>
      parseResearchAnswer(
        JSON.stringify({
          summary: [{ text: "Выдумка", citations: [{ source_id: "S2", excerpt_id: "E1" }] }],
          disagreements: [],
          gaps: []
        }),
        run
      ),
    /SYNTHESIS_INVALID_CITATION/
  );
  assert.throws(
    () =>
      parseResearchAnswer(
        JSON.stringify({
          summary: [{ text: "Выдумка", citations: [{ source_id: "S1", excerpt_id: "E2" }] }],
          disagreements: [],
          gaps: []
        }),
        run
      ),
    /SYNTHESIS_INVALID_CITATION/
  );
  run.answer = answer;
  assert(researchMarkdown(run).includes("[S1:E1](https://example.com/)"));
  console.log(
    "PASS research: cited synthesis references real fetched excerpt IDs; false references blocked"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
