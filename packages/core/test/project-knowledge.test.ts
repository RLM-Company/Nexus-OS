import { expect, it } from "vitest";
import {
  knowledgeHash,
  knowledgeTerms,
  searchKnowledgeSources,
  type KnowledgeSource
} from "../src/project-knowledge.js";
const source = (text: string, title = "Note", id = "source"): KnowledgeSource => ({
  reference: { kind: "canvas", id, version: 1, sha256: knowledgeHash(text) },
  title,
  text
});
it("normalizes searchable words without changing quoted evidence or original offsets", () => {
  const text = "Ёжик и ＡＩ\r\nБюджет проекта: 100 ₽";
  const hits = searchKnowledgeSources([source(text)], "ежик ai проект");
  expect(hits).toHaveLength(1);
  expect(hits[0]!.matched_terms).toEqual(["ежик", "ai", "проект"]);
  expect(hits[0]!.excerpt).toBe(text);
  expect(hits[0]!.reference.excerpt_sha256).toBe(knowledgeHash(text));
  expect(hits[0]).toMatchObject({ line_start: 1, line_end: 2, match_in: ["content"] });
});
it("marks title-only matches and ranks coverage over a single repeated word", () => {
  const hits = searchKnowledgeSources(
    [
      source("noise", "Project budget", "title"),
      source("project ".repeat(500), "Note", "single"),
      source("project budget", "Note", "both")
    ],
    "project budget"
  );
  expect(hits[0]!.reference.id).toBe("both");
  expect(hits.find((h) => h.reference.id === "title")!.match_in).toEqual(["title"]);
  expect(hits.findIndex((h) => h.reference.id === "both")).toBeLessThan(
    hits.findIndex((h) => h.reference.id === "single")
  );
});
it("keeps excerpts on Unicode and CRLF boundaries with exact source coordinates", () => {
  const text = "x".repeat(1199) + "🚀\r\nПроект\r\n" + "y".repeat(1400) + " Проекта";
  const hits = searchKnowledgeSources([source(text)], "проект");
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    const { start, end, excerpt_sha256 } = hit.reference;
    expect(hit.excerpt).toBe(text.slice(start, end));
    expect(knowledgeHash(hit.excerpt)).toBe(excerpt_sha256);
    expect(hit.excerpt.length).toBeLessThanOrEqual(1200);
    expect(hit.excerpt).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    expect(!(text[start] === "\n" && text[start - 1] === "\r")).toBe(true);
  }
});
it("limits source dominance and produces stable results without executing code or HTML", () => {
  const sources = [
    source("project ".repeat(1000), "<script>throw 1</script>", "long"),
    source("project owner", "Other", "short")
  ];
  const hits = searchKnowledgeSources(sources, "project", 30);
  expect(hits.filter((h) => h.reference.id === "long").length).toBeLessThanOrEqual(2);
  expect(hits.some((h) => h.reference.id === "short")).toBe(true);
  expect(searchKnowledgeSources(sources, "project", 30)).toEqual(hits);
  expect(searchKnowledgeSources(sources, "absent")).toEqual([]);
});
it("uses prefix tokens rather than arbitrary substring matches and accepts short AI terms", () => {
  expect(searchKnowledgeSources([source("said, availability, ai assistant")], "ai")).toHaveLength(
    1
  );
  expect(searchKnowledgeSources([source("said availability")], "ai")).toEqual([]);
  expect(knowledgeTerms("ИИ AI _code")).toEqual(["ии", "ai", "_code"]);
});
it("rejects unsupported queries and excessive input instead of silently changing them", () => {
  for (const query of ["", "***", "a", "x".repeat(201), "q".repeat(81)])
    expect(() => knowledgeTerms(query)).toThrow("KNOWLEDGE_QUERY_INVALID");
  expect(knowledgeTerms('* OR "')).toEqual(["or"]);
  expect(() => searchKnowledgeSources([source("text")], "text", 31)).toThrow(
    "KNOWLEDGE_INPUT_LIMIT"
  );
  expect(() => searchKnowledgeSources([source("x".repeat(8_000_001))], "text")).toThrow(
    "KNOWLEDGE_INPUT_LIMIT"
  );
});
