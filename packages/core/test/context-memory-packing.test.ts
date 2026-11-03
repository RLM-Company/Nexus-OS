import { describe, expect, it, vi } from "vitest";
import type { ContextMemoryBundle, ContextMemoryEvidence } from "@cosmora/contracts";
import {
  fitContextMemory,
  mergeContextMemory,
  MemoryContextIncompleteError
} from "../src/context-memory.js";
import { legacyFitContextMemory } from "./fixtures/context-packing-reference.js";

const item = (text: string, priority = false): ContextMemoryEvidence => ({
  reference: "M:source",
  kind: "memory",
  memory_kind: "fact",
  priority,
  title: "Source",
  text,
  source: null,
  excerpt_only: false
});
const bundle = (items: ContextMemoryEvidence[], omitted = 0): ContextMemoryBundle => ({
  format: "kosmora.context-memory.v1",
  target: { kind: "chat", id: "chat" },
  bytes: 0,
  omitted,
  priority_omitted: 0,
  budget_bytes: 1000000,
  retrieval: "lexical",
  items
});
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function exactSize(value: ContextMemoryBundle): number {
  const result = { ...value, bytes: 0 };
  for (let i = 0; i < 20; i++) {
    const actual = byteLength(result);
    if (actual === result.bytes) return actual;
    result.bytes = actual;
  }
  throw new Error("Wire size did not converge");
}
const outcome = (fn: () => unknown) => {
  try {
    return { value: fn() };
  } catch (error) {
    return { error: (error as Error).name };
  }
};

describe("production memory packing", () => {
  it("fits required memory at its exact boundary, including the size field's digits", () => {
    const input = bundle([item('Обязательное 😀\n"\\\ud800', true)], 99);
    const size = exactSize(input);
    const result = fitContextMemory(input, size)!;
    expect(result.bytes).toBe(size);
    expect(byteLength(result)).toBe(size);
    expect(() => fitContextMemory(input, size - 1)).toThrow(MemoryContextIncompleteError);
  });
  it("is independent of property order and literal marker-like user text", () => {
    const original = bundle([item("__kosmora_items_marker_7b4a__\n__kosmora_bytes_marker_91d2__")]);
    original.target.id = "__kosmora_items_marker_7b4a__";
    // Move properties genuinely, rather than just overwriting their values.
    const reversed = Object.fromEntries(
      Object.entries(original).reverse()
    ) as unknown as ContextMemoryBundle;
    for (const input of [original, reversed]) {
      const result = fitContextMemory(input, exactSize(input))!;
      expect(result.items).toEqual(input.items);
      expect(result.bytes).toBe(byteLength(result));
    }
  });
  it("handles decimal boundaries in bytes and omitted without over/under counting", () => {
    for (const omitted of [0, 8, 9, 10, 98, 99, 100, 999, 1000]) {
      for (const length of [1, 600, 700, 9700, 9800]) {
        const input = bundle([item("x".repeat(length))], omitted);
        const result = fitContextMemory(input, exactSize(input))!;
        expect(result.bytes).toBe(byteLength(result));
        expect(fitContextMemory(input, result.bytes - 1)).toBeUndefined();
      }
    }
  });
  it("retains mandatory entries and skips an oversized optional entry for a smaller one", () => {
    const pinned = item("required", true),
      large = item("x".repeat(4000)),
      small = item("small");
    const input = bundle([large, pinned, small]);
    const expected = { ...input, items: [pinned, small], omitted: 1 };
    const result = fitContextMemory(input, exactSize(expected))!;
    expect(result.items).toEqual([pinned, small]);
    expect(result.omitted).toBe(1);
    const constraint = { ...item("constraint"), memory_kind: "constraint" as const };
    expect(() => fitContextMemory(bundle([constraint]), 0)).toThrow(MemoryContextIncompleteError);
  });
  it("does not mutate frozen data and keeps a negative framing remainder compatible", () => {
    const input = bundle([item("first"), item("pinned", true)]);
    input.items.forEach(Object.freeze);
    Object.freeze(input.items);
    Object.freeze(input);
    const before = JSON.stringify(input);
    expect(fitContextMemory(input, 10000)!.items.map((e) => e.text)).toEqual(["pinned", "first"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(fitContextMemory(bundle([item("optional")]), -10)).toBeUndefined();
    expect(fitContextMemory(bundle([]), -10)).toBeUndefined();
    expect(() => fitContextMemory(input, -10)).toThrow(MemoryContextIncompleteError);
  });
  it("preserves merge provenance, deduplication and mandatory evidence", () => {
    const a = bundle([item("same"), item("distinct")]);
    const b = bundle([item("same", true)], 9);
    const merged = mergeContextMemory(a, b)!;
    expect(merged.items).toEqual([{ ...a.items[0], priority: true }, a.items[1]]);
    expect(merged.bytes).toBe(byteLength(merged));
    expect(merged.omitted).toBe(9);
    expect(() => mergeContextMemory(a, { ...b, target: { kind: "project", id: "other" } })).toThrow(
      "MEMORY_TARGET_MISMATCH"
    );
    expect(() => fitContextMemory({ ...a, priority_omitted: 1 }, 1000000)).toThrow(
      MemoryContextIncompleteError
    );
  });
  it("matches the original algorithm across deterministic varied data and tight budgets", () => {
    let seed = 91231;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 60; trial++) {
      const input = bundle(
        Array.from({ length: 1 + (random() % 25) }, (_, i) => ({
          ...item(
            ["а😀\n", 'x\\"', "\ud800"][random() % 3]!.repeat(1 + (random() % 35)),
            random() % 7 === 0
          ),
          reference: `M:${trial}:${i}`,
          memory_kind: random() % 11 === 0 ? ("constraint" as const) : ("fact" as const)
        })),
        random() % 101
      );
      for (const budget of [0, 500, 1000, 3000, exactSize(input), 100000])
        expect(outcome(() => fitContextMemory(input, budget))).toEqual(
          outcome(() => legacyFitContextMemory(input, budget))
        );
    }
  });
  it("encodes a linear volume of data instead of growing prefixes for each candidate", () => {
    const input = bundle(
      Array.from({ length: 500 }, (_, i) => ({
        ...item("payload 😀".repeat(15)),
        reference: `M:${i}`
      }))
    );
    const fullLength = JSON.stringify(input).length;
    const encode = TextEncoder.prototype.encode.bind(new TextEncoder());
    let characters = 0;
    const spy = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function (
      this: TextEncoder,
      text?: string
    ) {
      characters += text?.length ?? 0;
      return encode(text);
    });
    try {
      expect(fitContextMemory(input, 1000000)!.items).toHaveLength(500);
    } finally {
      spy.mockRestore();
    }
    expect(characters).toBeLessThan(fullLength * 3);
  });
  it("rejects unsafe combined counters", () => {
    for (const field of ["budget_bytes", "omitted", "priority_omitted"] as const) {
      expect(() =>
        mergeContextMemory(
          { ...bundle([]), [field]: Number.MAX_SAFE_INTEGER },
          { ...bundle([]), [field]: 1 }
        )
      ).toThrow(RangeError);
    }
  });
  it("rejects non-finite budgets and unsafe omission accounting", () => {
    for (const budget of [NaN, Infinity, -Infinity, 0.5])
      expect(() => fitContextMemory(bundle([]), budget)).toThrow(RangeError);
    expect(() => fitContextMemory(bundle([item("x")], Number.MAX_SAFE_INTEGER), 1000000)).toThrow(
      RangeError
    );
  });
});
