import { describe, expect, it } from "vitest";
import type { ContextMemoryBundle, ModelMessage } from "@cosmora/contracts";
import { fitContextMessages } from "../src/context-messages.js";
import { CONTEXT_MEMORY_RULES, MemoryContextIncompleteError } from "../src/context-memory.js";
import { ContextTooLargeError, estimateInputTokensUpperBound } from "../src/conversation-window.js";
import { ManagerService } from "../src/manager.js";

const memory = (required = false): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "project", id: "project" },
  bytes: 0,
  budget_bytes: 6000,
  omitted: 0,
  priority_omitted: 0,
  retrieval: "lexical",
  items: [
    {
      reference: "M:original",
      kind: "memory",
      title: "Source",
      text: 'Точная ставка 17.5%. 😀 "\\\ud800'.repeat(20),
      source: null,
      memory_kind: required ? "constraint" : "fact",
      priority: required,
      excerpt_only: false
    }
  ]
});
const render =
  (materials = "Owner materials", image = false) =>
  (pack: ContextMemoryBundle | undefined): ModelMessage[] => [
    { role: "system", content: "Work rules" + (pack?.items.length ? CONTEXT_MEMORY_RULES : "") },
    {
      role: "user",
      content: JSON.stringify({
        goal: "Exact current goal",
        materials,
        recalled_memory: pack?.items.length ? pack : undefined,
        draft: "Never shorten this draft"
      }),
      ...(image ? { images: [{ media_type: "image/jpeg" as const, data_base64: "/9j/2Q==" }] } : {})
    }
  ];
const measure = estimateInputTokensUpperBound;

describe("whole Work context packing", () => {
  it("accounts the complete envelope and conditional rules at an exact boundary", () => {
    const draw = render('Материалы 😀 "\\\ud800');
    const full = fitContextMessages({
      render: draw,
      memory: memory(),
      inputBudget: 50000,
      query: "ставка"
    });
    const size = measure(full.messages);
    const exact = fitContextMessages({
      render: draw,
      memory: memory(),
      inputBudget: size,
      query: "ставка"
    });
    expect(exact).toEqual(full);
    expect(
      fitContextMessages({ render: draw, memory: memory(), inputBudget: size - 1, query: "ставка" })
        .memory
    ).toBeUndefined();
    expect(() =>
      fitContextMessages({
        render: draw,
        memory: memory(true),
        inputBudget: size - 1,
        query: "ставка"
      })
    ).toThrow(MemoryContextIncompleteError);
  });
  it("keeps materials, goal and draft unchanged when optional memory cannot fit", () => {
    const draw = render("x".repeat(5000));
    const base = draw(undefined);
    const result = fitContextMessages({
      render: draw,
      memory: memory(),
      inputBudget: measure(base),
      query: "ставка"
    });
    expect(result).toEqual({ messages: base, memory: undefined });
    expect(JSON.parse(result.messages[1]!.content)).toEqual({
      goal: "Exact current goal",
      materials: "x".repeat(5000),
      draft: "Never shorten this draft"
    });
  });
  it("rejects oversized mandatory payload without cutting an artifact or making a call", () => {
    const draw = render("x".repeat(5000));
    expect(() =>
      fitContextMessages({ render: draw, memory: undefined, inputBudget: 1000, query: "" })
    ).toThrow(ContextTooLargeError);
  });
  it("reserves images before optional or required recalled text", () => {
    const draw = render("Materials", true);
    const budget = measure(draw(undefined));
    expect(budget).toBeGreaterThan(16000);
    expect(
      fitContextMessages({ render: draw, memory: memory(), inputBudget: budget, query: "ставка" })
        .memory
    ).toBeUndefined();
    expect(() =>
      fitContextMessages({
        render: draw,
        memory: memory(true),
        inputBudget: budget,
        query: "ставка"
      })
    ).toThrow(MemoryContextIncompleteError);
    expect(() =>
      fitContextMessages({ render: draw, memory: undefined, inputBudget: budget - 1, query: "" })
    ).toThrow(ContextTooLargeError);
  });
  it("does not mutate frozen inputs or erase pre-existing omitted priority evidence", () => {
    const pack = memory();
    const before = JSON.stringify(pack);
    pack.items.forEach(Object.freeze);
    Object.freeze(pack.items);
    Object.freeze(pack);
    fitContextMessages({ render: render(), memory: pack, inputBudget: 50000, query: "" });
    expect(JSON.stringify(pack)).toBe(before);
    expect(() =>
      fitContextMessages({
        render: render(),
        memory: { ...pack, items: [], priority_omitted: 1 },
        inputBudget: 50000,
        query: ""
      })
    ).toThrow(MemoryContextIncompleteError);
  });
  it("rejects renderers that hide or transform the evidence", () => {
    expect(() =>
      fitContextMessages({
        render: () => [{ role: "user", content: "Memory omitted" }],
        memory: memory(),
        inputBudget: 50000,
        query: ""
      })
    ).toThrow("MEMORY_SERIALIZATION_MISMATCH");
  });
  it("uses the configured large model allowance without a new 32K limit", () => {
    const manager = new ManagerService({
      preferredProvider: "mock",
      preferredModelAlias: "manager",
      fallbackAllowed: false,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 100_000
    });
    expect(manager.inputContextBudget).toBe(895904);
    const result = fitContextMessages({
      render: render("x".repeat(100000)),
      memory: memory(true),
      inputBudget: manager.inputContextBudget,
      query: "ставка"
    });
    expect(measure(result.messages)).toBeGreaterThan(100000);
    expect(result.memory?.items).toHaveLength(1);
  });
  it("rejects malformed budget values", () => {
    for (const value of [NaN, Infinity, -1, 0.5])
      expect(() =>
        fitContextMessages({ render: render(), memory: undefined, inputBudget: value, query: "" })
      ).toThrow(RangeError);
  });
});
