import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  researchSourceReceipts,
  reviseResearchQuestion,
  type ResearchAnswer,
  type ResearchRun
} from "../src/research/index.js";

const at = "2026-11-25T10:00:00.000Z";
const run: ResearchRun = {
  id: "run-1",
  owner_id: "a",
  actor_id: "a",
  project_id: "p",
  question: "Срок поставки по договору",
  status: "completed",
  stage: "done",
  candidates: [],
  next_index: 2,
  sources: [
    {
      title: "Договор №1",
      url: "https://example.test/contract",
      snippet: "",
      status: "duplicate",
      passages: [],
      checked_at: at
    },
    {
      title: "Договор №2 (снимок)",
      url: "https://example.test/contract-v2",
      snippet: "",
      status: "read",
      passages: ["Срок поставки — 12 октября 2027 [ differing units: 12 недель ]"],
      checked_at: at,
      content_digest: "a".repeat(64)
    }
  ],
  attempts: 1,
  error_code: null,
  created_at: at,
  updated_at: at
};
const answer: ResearchAnswer = {
  summary: [
    {
      text: "Договор допускает поставку в октябре 2027.",
      citations: [{ source_id: "S2", excerpt_id: "E1" }]
    }
  ],
  disagreements: [],
  gaps: ["Единицы срока не согласованы."]
};

describe("research source receipts (format agreed with OpenCode №1)", () => {
  it("binds each claim to the exact verified quote, date, source and digest", () => {
    const receipts = researchSourceReceipts(run, answer);
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0]!;
    expect(receipt).toMatchObject({
      format: "kosmora.source-receipt.v1",
      source_id: "S2",
      excerpt_id: "E1",
      title: "Договор №2 (снимок)",
      url: "https://example.test/contract-v2",
      checked_at: at,
      content_digest: "a".repeat(64),
      position: 0
    });
    expect(receipt.excerpt_sha256).toBe(
      createHash("sha256").update(run.sources[1]!.passages[0]!).digest("hex")
    );
    expect(receipt.quote).toContain("12 октября 2027");
    expect(receipt.quote).toContain("12 недель");
    expect(answer.gaps[0]).toContain("Единицы");
  });

  it("a verified new fact redirects the next research step with its receipt date", () => {
    const receipt = researchSourceReceipts(run, answer)[0]!;
    const revised = reviseResearchQuestion(
      "Какой срок поставки?",
      {
        text: "Снимок S2 показывает 12 недель вместо октября 2027.",
        checked_at: receipt.checked_at,
        source_id: receipt.source_id
      },
      answer.gaps
    );
    expect(revised).toContain("Какой срок поставки?");
    expect(revised).toContain("2026-11-25T10:00:00.000Z");
    expect(revised).toContain("S2");
    expect(revised).toContain("12 недель");
    expect(revised).toContain("Единицы срока не согласованы");
  });

  it("never invents a receipt for an unread source or an unknown excerpt", () => {
    const forged: ResearchAnswer = {
      summary: [
        {
          text: "Неподтверждённое утверждение.",
          citations: [
            { source_id: "S1", excerpt_id: "E1" },
            { source_id: "S2", excerpt_id: "E9" }
          ]
        }
      ],
      disagreements: [],
      gaps: []
    };
    expect(researchSourceReceipts(run, forged)).toEqual([]);
  });
});
