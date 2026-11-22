import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  answerCoverageLines,
  answerReportLines,
  createDocxReport,
  type AnswerReport
} from "./studio-files-report";

describe("document report export", () => {
  it("creates an editable Word package without invalid XML from source control characters", async () => {
    const report = createDocxReport(["Факт & <источник> 😀", "Текст\u0000с символом\ud800"]);
    const archive = unzipSync(new Uint8Array(await report.arrayBuffer()));
    const document = strFromU8(archive["word/document.xml"]!);
    expect(document).toContain("Факт &amp; &lt;источник&gt; 😀");
    expect(document).toContain("Текст\ufffdс символом\ufffd");
    expect(document).not.toContain("\u0000");
    expect(archive["[Content_Types].xml"]).toBeDefined();
    expect(strFromU8(archive["_rels/.rels"]!)).toContain('Target="word/document.xml"');
  });
});

type Coverage = NonNullable<AnswerReport["coverage"]>;
const answer = (coverage: Coverage): AnswerReport => ({
  id: "a1",
  question: "Что в пакете?",
  answer: "Ответ модели",
  status: "completed",
  error_code: null,
  coverage,
  citations: ["S1"],
  sources: [
    {
      ref: "S1",
      name: "contract.pdf",
      page: 2,
      line_start: 10,
      line_end: 12,
      content: "Дословная цитата"
    }
  ]
});

describe("answer coverage and report lines", () => {
  it("shows coverage, errors, unprocessed chunks and text-page counts for a partial package", () => {
    const coverage: Coverage = {
      total_chunks: 5,
      analyzed_chunks: 3,
      failed_chunks: 1,
      phase: "synthesis",
      files: [
        {
          name: "contract.pdf",
          chunks: 3,
          analyzed_chunks: 2,
          failed_chunks: 1,
          is_pdf: true,
          total_pages: 4,
          indexed_pages: 2
        },
        {
          name: "notes.txt",
          chunks: 2,
          analyzed_chunks: 1,
          failed_chunks: 0,
          is_pdf: false,
          total_pages: null,
          indexed_pages: null
        }
      ]
    };
    const lines = answerCoverageLines(coverage);
    expect(lines[0]).toContain("Фрагменты разобраны: 3 из 5");
    expect(lines[0]).toContain("Ошибки обработки: 1");
    expect(lines[0]).toContain("Не обработано: 1");
    expect(lines[1]).toContain("contract.pdf — 2 из 3 фрагментов, ошибок: 1");
    expect(lines[1]).toContain("Страниц с текстом в индексе: 2 из 4");
    expect(lines[2]).toContain("notes.txt — 1 из 2 фрагментов");
    expect(lines[2]).not.toContain("Страниц");
  });

  it("treats a missing page count as an explicit unknown rather than inventing a number", () => {
    const coverage: Coverage = {
      total_chunks: 1,
      analyzed_chunks: 1,
      failed_chunks: 0,
      phase: "complete",
      files: [
        {
          name: "scan.pdf",
          chunks: 1,
          analyzed_chunks: 1,
          failed_chunks: 0,
          is_pdf: true,
          total_pages: null,
          indexed_pages: 1
        }
      ]
    };
    const lines = answerCoverageLines(coverage);
    expect(lines[1]).toContain("Всего страниц неизвестно.");
  });

  it("includes only cited sources with page and line references in the report", () => {
    const report = answer({
      total_chunks: 1,
      analyzed_chunks: 1,
      failed_chunks: 0,
      phase: "complete",
      files: []
    });
    const lines = answerReportLines(report);
    expect(lines).toContain("Вопрос: Что в пакете?");
    expect(lines.some((line) => line.includes("[S1] contract.pdf, стр. 2"))).toBe(true);
    expect(lines).toContain("Дословная цитата");
  });
});
