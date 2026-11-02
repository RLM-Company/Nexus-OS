import { describe, expect, it } from "vitest";
import type { ContextMemoryBundle, ContextMemoryEvidence } from "@cosmora/contracts";
import { compactContextEvidence, rankContextEvidence } from "../src/context-evidence-selection.js";
import {
  fitContextMemory,
  mergeContextMemory,
  MemoryContextIncompleteError
} from "../src/context-memory.js";

const evidence = (
  text: string,
  patch: Partial<ContextMemoryEvidence> = {}
): ContextMemoryEvidence => ({
  reference: "H:g:original",
  kind: "history",
  title: "2026-11-02T09:00:00Z",
  text,
  source: {
    kind: "chat_message",
    message_id: "original",
    chat_id: "chat",
    project_id: null,
    role: "user",
    quote: text,
    sha256: "a".repeat(64)
  },
  excerpt_only: true,
  ...patch
});
const bundle = (items: ContextMemoryEvidence[]): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "chat" },
  items,
  omitted: 0,
  priority_omitted: 0,
  bytes: 0,
  budget_bytes: 12000,
  retrieval: "lexical"
});

describe("lossless runtime evidence selection", () => {
  it("transmits an identical source quote once, without modifying the original", () => {
    const input = evidence("Точная ставка 17.5%, срок 02.11.2026. 😀");
    Object.freeze(input.source);
    Object.freeze(input);
    const before = JSON.stringify(input);
    const [packed] = compactContextEvidence([input]);
    expect(packed).toEqual({ ...input, source: { ...input.source!, quote: "" } });
    expect(JSON.stringify(input)).toBe(before);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(Buffer.byteLength(before));
  });
  it("does not erase a different source quote supporting a saved interpretation", () => {
    const item = evidence("Согласие ещё не получено.", {
      kind: "memory",
      memory_kind: "hypothesis",
      reference: "M:fact"
    });
    item.source!.quote = "Надо спросить Джалиля.";
    expect(compactContextEvidence([item])).toEqual([item]);
  });
  it.each([false, true])("folds covered history spans regardless of ordering (%s)", (reverse) => {
    const text = "Лимит 17350.25 ₽. Не менять sidebar. Срок 02.11.2026.";
    const short = evidence("Не менять sidebar.", { priority: true, sequence: 4 });
    const full = evidence(text, { priority: true });
    const input = reverse ? [full, short] : [short, full];
    const fitted = fitContextMemory(bundle(input), 12000)!;
    expect(fitted.items).toHaveLength(1);
    expect(fitted.items[0]).toMatchObject({
      text,
      reference: full.reference,
      priority: true,
      sequence: 4,
      source: { role: "user", message_id: "original", sha256: "a".repeat(64) }
    });
    expect(fitted.omitted).toBe(0); // Covered evidence was not lost to the budget.
    expect(fitted.bytes).toBe(Buffer.byteLength(JSON.stringify(fitted)));
  });
  it("preserves independent references, versions, roles, source hashes and kinds", () => {
    const original = evidence("Совпадающие слова.");
    const variants = [
      original,
      { ...original, reference: "H:g:another" },
      { ...original, version: 2 },
      { ...original, memory_kind: "hypothesis" as const },
      { ...original, source: { ...original.source!, role: "assistant" as const } },
      { ...original, source: { ...original.source!, sha256: "b".repeat(64) } },
      { ...original, sequence: 1 },
      { ...original, sequence: 2 }
    ];
    // The sequence-less original can cover only one compatible chronological item.
    const result = compactContextEvidence(variants);
    expect(result).toHaveLength(7);
    expect(result.some((e) => e.sequence === 1)).toBe(true);
    expect(result.some((e) => e.sequence === 2)).toBe(true);
    expect(result.filter((e) => e.source?.role === "assistant")).toHaveLength(1);
  });
  it("does not inflate a small mandatory span into a large optional passage", () => {
    const small = evidence("Не менять sidebar.", { priority: true });
    const full = evidence(small.text + "x".repeat(4000));
    const limit = fitContextMemory({ ...bundle([small]), omitted: 1 }, 12000)!.bytes;
    const fitted = fitContextMemory(bundle([full, small]), limit)!;
    expect(fitted.items).toHaveLength(1);
    expect(fitted.items[0]!.text).toBe(small.text);
    expect(fitted.omitted).toBe(1);
  });
  it("keeps distinct literal numbers and independently worded saved facts", () => {
    const values = [evidence("Ставка 20²."), evidence("Ставка 202.")];
    expect(compactContextEvidence(values)).toHaveLength(2);
    const facts = ["лимит 20", "не лимит 20"].map((text) =>
      evidence(text, {
        kind: "memory",
        memory_kind: "fact",
        source: null
      })
    );
    expect(compactContextEvidence(facts)).toHaveLength(2);
  });
  it("does not merge different nonredundant source quotes", () => {
    const a = evidence("Одинаковая интерпретация.");
    const b = evidence(a.text);
    a.source!.quote = "Первая исходная цитата.";
    b.source!.quote = "Вторая исходная цитата.";
    expect(compactContextEvidence([a, b])).toHaveLength(2);
  });
  it("still removes exact duplicates in large groups without quadratic containment", () => {
    const entries = Array.from({ length: 90 }, (_, i) => evidence(`фрагмент_${i}`));
    expect(compactContextEvidence([...entries, ...entries])).toHaveLength(90);
  });
  it("ranks optional evidence by query coverage, including short numeric terms", () => {
    const items = [
      evidence("Расписание рейса 21", { reference: "H:g:a" }),
      evidence("Договор подписан", { reference: "H:g:b" }),
      evidence("Договор 20 подписан", { reference: "H:g:c" })
    ];
    expect(rankContextEvidence(items, "Покажи договор 20").map((e) => e.reference)).toEqual([
      "H:g:c",
      "H:g:b",
      "H:g:a"
    ]);
    expect(rankContextEvidence(items)).toEqual(items);
  });
  it("uses scarce space for relevant evidence while preserving mandatory requirements", () => {
    const old = evidence("Посторонняя тема. " + "x".repeat(400), { reference: "H:g:old" });
    const wanted = evidence("Договор 20. " + "x".repeat(400), { reference: "H:g:wanted" });
    const limit = fitContextMemory({ ...bundle([wanted]), omitted: 1 }, 12000)!.bytes;
    const fitted = fitContextMemory(bundle([old, wanted]), limit, "Договор 20")!;
    expect(fitted.items.map((e) => e.reference)).toEqual(["H:g:wanted"]);
    expect(fitted.omitted).toBe(1);
    expect(fitted.bytes).toBeLessThanOrEqual(limit);
    const mandatory = { ...old, memory_kind: "constraint" as const };
    expect(rankContextEvidence([wanted, mandatory], "Договор 20")[0]).toBe(mandatory);
    expect(() => fitContextMemory(bundle([mandatory, wanted]), 0, "Договор 20")).toThrow(
      MemoryContextIncompleteError
    );
  });
  it("retains distinct reference links when merging equal text", () => {
    const a = evidence("Одинаковая цитата.");
    const b = { ...a, reference: "M:another" };
    expect(mergeContextMemory(bundle([a]), bundle([b]))!.items.map((e) => e.reference)).toEqual([
      a.reference,
      b.reference
    ]);
  });
});
