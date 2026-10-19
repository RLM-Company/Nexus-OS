import { describe, expect, it } from "vitest";
import { parseIntelligenceGraphPackage } from "../src/intelligence-graph-package.js";
const valid = () => ({
  format: "kosmora.intelligence-graph.v1",
  title: "Связи",
  nodes: [
    { key: "a", kind: "Claim", label: "😀 <b> $&", detail: "Строка 1\r\nСтрока 2\n" },
    { key: "b", kind: "Source", label: "Документ", detail: "Точная цитата" }
  ],
  edges: [{ relation: "SUPPORTS", from: "b", to: "a" }]
});
describe("portable graph content", () => {
  it("preserves exact Unicode, CRLF and literal text, returning detached canonical objects", () => {
    const input = valid();
    const result = parseIntelligenceGraphPackage(JSON.stringify(input));
    expect(result).toEqual(input);
    const detached = parseIntelligenceGraphPackage(input);
    detached.nodes[0]!.label = "Changed";
    expect(input.nodes[0]!.label).toBe("😀 <b> $&");
    expect(Object.keys(result)).toEqual(["format", "title", "nodes", "edges"]);
  });
  it.each(["owner_id", "verification_status", "privileges", "__proto__"])(
    "rejects extra %s metadata rather than granting authority",
    (key) => {
      const input = valid();
      Object.defineProperty(input, key, { value: "verified", enumerable: true });
      expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    }
  );
  it("rejects foreign endpoints, self links, duplicate keys and unsupported types", () => {
    const input = valid();
    input.edges[0]!.to = "missing";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    input.edges[0]!.to = "b";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    input.nodes[1]!.key = "a";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    input.nodes[0]!.kind = "Admin";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
  });
  it("rejects whitespace-only fields, controls, oversize files and excess versions", () => {
    const input = valid();
    input.title = " ";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    input.title = "bad\u0000";
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
    expect(() => parseIntelligenceGraphPackage(" ".repeat(800001))).toThrow();
    input.title = "Valid";
    input.nodes = Array.from({ length: 151 }, (_, i) => ({ ...input.nodes[0]!, key: "n" + i }));
    expect(() => parseIntelligenceGraphPackage(input)).toThrow();
  });
});

describe("portable exact citations", () => {
  it("retains an exact source fragment and canonical metadata", () => {
    const input = valid();
    const cited = {
      ...input,
      edges: [
        {
          ...input.edges[0]!,
          evidence: { source: "b", location: "страница 4, строки 1–2", excerpt: "Точная цитата" }
        }
      ]
    };
    expect(parseIntelligenceGraphPackage(cited)).toEqual(cited);
  });
  it("rejects missing/wrong-kind sources, invented quotes and verification fields", () => {
    const input = valid();
    for (const evidence of [
      { source: "missing", location: "p.1", excerpt: "Точная цитата" },
      { source: "a", location: "p.1", excerpt: "😀 <b> $&" },
      { source: "b", location: "p.1", excerpt: "Несуществующий фрагмент" },
      { source: "b", location: "p.1", excerpt: "Точная цитата", verified: true }
    ])
      expect(() =>
        parseIntelligenceGraphPackage({ ...input, edges: [{ ...input.edges[0]!, evidence }] })
      ).toThrow();
  });
});
