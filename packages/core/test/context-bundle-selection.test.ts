import { describe, expect, it } from "vitest";
import type { ContextMemoryBundle, ContextMemoryEvidence } from "@cosmora/contracts";
import { selectContextBundle } from "../src/context-memory.js";

const item = (
  over: Partial<ContextMemoryEvidence> & { owner?: string }
): ContextMemoryEvidence => ({
  reference: "M:item",
  kind: "memory",
  memory_kind: "fact",
  title: "Решение",
  text: "fact",
  source: null,
  excerpt_only: false,
  ...over
});
const bundle = (items: ContextMemoryEvidence[]): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "chat-1" },
  items,
  omitted: 0,
  priority_omitted: 0,
  bytes: 0,
  budget_bytes: 6000,
  retrieval: "lexical",
  answer_evidence: "absent",
  matched_items: 0
});

describe("production context bundle selection", () => {
  it("drops foreign owner evidence in the assembled bundle", () => {
    const selected = selectContextBundle(
      bundle([
        item({ reference: "M:self", owner: "A", matched: true }),
        item({ reference: "M:foreign", owner: "B", matched: true })
      ]),
      { owner: "A", query: "fact" }
    );
    expect(selected?.items.map((entry) => entry.reference)).toEqual(["M:self"]);
  });

  it("keeps mandatory constraints and honest match counters", () => {
    const selected = selectContextBundle(
      bundle([
        item({ reference: "M:rule", priority: true, memory_kind: "constraint", matched: true }),
        item({ reference: "M:lookalike", matched: false })
      ]),
      { owner: "A", query: "rule" }
    );
    expect(selected?.items.map((entry) => entry.reference)).toEqual(["M:rule"]);
    expect(selected?.answer_evidence).toBe("matched");
    expect(selected?.matched_items).toBe(1);
  });

  it("returns undefined when nothing is selected", () => {
    expect(selectContextBundle(undefined, { owner: "A" })).toBeUndefined();
  });
});
