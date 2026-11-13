import { describe, expect, it } from "vitest";
import { researchMarkdown, type ResearchRun, type ResearchSource } from "../src/research/index.js";

const source = (url: string, extra: Partial<ResearchSource> = {}): ResearchSource => ({
  title: "Прайс",
  url,
  snippet: "",
  status: "read",
  passages: ["Цена Alpha: 50 рублей."],
  checked_at: "2026-11-13T09:00:00Z",
  ...extra
});
const run = (sources: ResearchSource[], disagreements: number = 0): ResearchRun => ({
  id: "r1",
  owner_id: "a",
  actor_id: "a",
  project_id: "p1",
  question: "Цена",
  status: "completed",
  stage: "",
  candidates: [],
  next_index: 0,
  sources,
  attempts: 1,
  error_code: null,
  answer: {
    summary: [],
    disagreements: Array.from({ length: disagreements }, () => ({
      text: "Расхождение",
      citations: [{ source_id: "S1", excerpt_id: "E1" }]
    })),
    gaps: []
  },
  created_at: "2026-11-13T09:00:00Z",
  updated_at: "2026-11-13T09:00:00Z"
});

describe("research report: honest deduplication and contradictions", () => {
  it("reports identical digests as one source, never independent confirmations", () => {
    const text = researchMarkdown(
      run([
        source("https://a.test/1", { content_digest: "same" }),
        source("https://b.test/2", { content_digest: "same" })
      ])
    );
    expect(text).toContain("Дубли и противоречия");
    expect(text).toContain("Дословно совпавших групп источников: 1 (S1, S2)");
    expect(text).toContain("не независимые подтверждения");
  });

  it("counts sources marked duplicate by the coordinator", () => {
    const text = researchMarkdown(
      run([
        source("https://a.test/1", { content_digest: "x" }),
        source("https://b.test/2", { status: "duplicate", passages: [] })
      ])
    );
    expect(text).toContain("Помечено дубликатами при чтении: 1");
    expect(text).toContain("не добавляют голосов");
  });

  it("preserves disagreements and never picks a winner by majority", () => {
    const text = researchMarkdown(
      run(
        [
          source("https://a.test/1", { content_digest: "a" }),
          source("https://b.test/2", { content_digest: "b" })
        ],
        2
      )
    );
    expect(text).toContain("Зафиксировано расхождений: 2");
    expect(text).toContain("победитель по большинству дублирующих сайтов не выбран");
    expect(text).toContain("противоречие не стёрто");
  });

  it("never calls a heuristic semantic proof", () => {
    const text = researchMarkdown(run([source("https://a.test/1")]));
    expect(text).toContain("не семантическое доказательство истинности");
    expect(text).not.toContain("семантически доказано");
  });

  it("does not claim independence when no duplicates exist", () => {
    const text = researchMarkdown(run([source("https://a.test/1")]));
    expect(text).toContain("не доказывает независимость источников");
  });
});
