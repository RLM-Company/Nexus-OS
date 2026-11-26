import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { parseResearchAnswer, researchSourceReceipts, type ResearchAnswer } from "@cosmora/core";
import { ResearchStore } from "../src/research/research-store.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const open = () => {
  const dir = mkdtempSync(join(tmpdir(), "research-receipts-"));
  const path = join(dir, "research.db");
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL("../src/research/migration.sql", import.meta.url), "utf8"));
  databases.push(db);
  return { store: new ResearchStore(db), path };
};

describe("research receipts in the user-visible run", () => {
  it("persists exact receipts with the answer; fabricated citations get none", () => {
    const { store: repository, path } = open();
    const run = repository.create("owner", "actor", "project", "Стоимость тарифа Alpha");
    repository.update(run.id, "owner", ["queued"], (state) => {
      state.sources = [
        {
          title: "Тарифы",
          url: "https://example.org/tariffs",
          snippet: "",
          status: "read",
          passages: ["Тариф Alpha стоит 50 рублей в месяц."],
          checked_at: "2026-11-26T10:00:00.000Z",
          content_digest: "digest-1"
        }
      ];
    });
    const current = repository.get(run.id, "owner")!;
    const answer: ResearchAnswer = parseResearchAnswer(
      JSON.stringify({
        summary: [
          {
            text: "Тариф Alpha стоит 50 рублей.",
            citations: [{ source_id: "S1", excerpt_id: "E1" }]
          }
        ],
        disagreements: [],
        gaps: []
      }),
      current
    );
    const receipts = researchSourceReceipts(current, answer);
    expect(receipts).toHaveLength(1);
    expect(() =>
      parseResearchAnswer(
        JSON.stringify({
          summary: [
            {
              text: "Неподтверждённое утверждение.",
              citations: [{ source_id: "S9", excerpt_id: "E9" }]
            }
          ],
          disagreements: [],
          gaps: []
        }),
        current
      )
    ).toThrow("SYNTHESIS_INVALID_CITATION");
    repository.update(run.id, "owner", ["queued", "synthesizing"], (state) => {
      state.answer = answer;
      state.receipts = receipts;
      state.status = "completed";
    });
    // Real reopen: the user's next read sees the same receipts and quote.
    const reopened = new ResearchStore(new DatabaseSync(path));
    const saved = reopened.get(run.id, "owner")!;
    expect(saved.answer?.summary[0]?.text).toContain("50 рублей");
    expect(saved.receipts).toHaveLength(1);
    expect(saved.receipts![0]).toMatchObject({
      format: "kosmora.source-receipt.v1",
      source_id: "S1",
      excerpt_id: "E1",
      title: "Тарифы",
      url: "https://example.org/tariffs",
      checked_at: "2026-11-26T10:00:00.000Z",
      content_digest: "digest-1"
    });
    expect(saved.receipts![0]!.quote).toContain("50 рублей");
  });
});
