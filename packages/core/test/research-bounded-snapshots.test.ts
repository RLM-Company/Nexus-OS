import { describe, expect, it } from "vitest";
import {
  researchMarkdown,
  researchHtml,
  researchSnapshotView,
  type ResearchRun,
  type ResearchSource
} from "../src/research/index.js";

const source = (extra: Partial<ResearchSource> = {}): ResearchSource => ({
  title: "Прайс",
  url: "https://a.test/1",
  snippet: "",
  status: "read",
  passages: ["Цена Alpha: 50 рублей."],
  checked_at: "2026-11-13T09:00:00Z",
  content_digest: "abcdef1234567890",
  ...extra
});
const run = (extra: Partial<ResearchRun> = {}): ResearchRun => ({
  id: "r1",
  owner_id: "a",
  actor_id: "a",
  project_id: "p1",
  question: "Цена",
  status: "completed",
  stage: "",
  candidates: [
    { title: "A", url: "https://a.test/1", snippet: "" },
    { title: "B", url: "https://b.test/2", snippet: "" },
    { title: "C", url: "https://c.test/3", snippet: "" }
  ],
  next_index: 1,
  sources: [source()],
  attempts: 1,
  error_code: null,
  answer: {
    summary: [],
    disagreements: [
      {
        text: "Цена 50 рублей против 5000 рублей",
        citations: [{ source_id: "S1", excerpt_id: "E1" }]
      }
    ],
    gaps: []
  },
  created_at: "2026-11-13T09:00:00Z",
  updated_at: "2026-11-13T09:00:00Z",
  ...extra
});

describe("research snapshot view", () => {
  it("identifies a source by digest and checked_at, not by URL alone", () => {
    const view = researchSnapshotView(run());
    expect(view.snapshots).toEqual([
      { id: "S1", digest: "abcdef123456", checked_at: "2026-11-13T09:00:00Z" }
    ]);
  });

  it("reports truncation honestly when candidates remain unread", () => {
    const view = researchSnapshotView(run());
    expect(view.read_count).toBe(1);
    expect(view.candidate_count).toBe(3);
    expect(view.truncated_by_limits).toBe(true);
  });

  it("never normalizes contradictions", () => {
    expect(researchSnapshotView(run()).contradictions).toEqual([
      "Цена 50 рублей против 5000 рублей"
    ]);
  });

  it("both report formats show snapshots, limits and contradictions", () => {
    const md = researchMarkdown(run());
    const html = researchHtml(run());
    for (const text of [md, html]) {
      expect(text).toContain("Снимки источников");
      expect(text).toContain("abcdef123456");
      expect(text).toContain("Границы исследования");
      expect(text).toContain("Достигнут предел просмотра");
      expect(text).toContain("5000 рублей");
      expect(text).toContain("победитель не выбран");
    }
  });

  it("explicitly says a truncated run is not exhaustive", () => {
    const md = researchMarkdown(run());
    expect(md).toContain("НЕ охватывает все найденные источники");
    expect(md).toContain("обрыв не означает, что остальные согласны");
  });

  it("handles a run without readable snapshots", () => {
    const unavailable: ResearchSource = {
      ...source(),
      status: "unavailable",
      passages: []
    };
    delete unavailable.content_digest;
    const view = researchSnapshotView(run({ sources: [unavailable] }));
    expect(view.snapshots).toEqual([]);
    expect(researchMarkdown(run({ sources: [] }))).toContain("Снимки с дайджестом отсутствуют");
  });
});
