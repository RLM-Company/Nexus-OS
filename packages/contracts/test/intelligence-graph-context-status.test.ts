import { describe, expect, it } from "vitest";
import { isIntelligenceGraphSavedContextStatus as valid } from "../src/intelligence-graph-context.js";

const base = { graph_revision: 2, materials_version: 0, current_sha256: "a".repeat(64) };
describe("saved context status response validation", () => {
  it("accepts every status and requires revision consistency", () => {
    expect(valid({ ...base, status: "missing", current_sha256: null, saved: null })).toBe(true);
    expect(valid({ ...base, status: "unrecognized", saved: null })).toBe(true);
    expect(valid({ ...base, status: "current", saved: { revision: 2, query: "Тезис" } })).toBe(
      true
    );
    expect(valid({ ...base, status: "stale", saved: { revision: 1, query: "Тезис" } })).toBe(true);
  });
  it.each([
    null,
    {},
    { items: [] },
    { ...base, status: "current", saved: null },
    { ...base, status: "current", saved: { revision: 1, query: "Тезис" } },
    { ...base, status: "stale", saved: { revision: 2, query: "Тезис" } },
    { ...base, status: "stale", saved: { revision: 0, query: "Тезис" } },
    { ...base, status: "stale", saved: { revision: 1, query: {} } },
    { ...base, status: "stale", saved: { revision: 1, query: " " } },
    { ...base, status: "missing", saved: null },
    { ...base, status: "unrecognized", saved: null, materials_version: -1 },
    { ...base, status: "unrecognized", saved: null, graph_revision: 0 },
    { ...base, status: "unrecognized", saved: null, current_sha256: "not-a-hash" }
  ])("rejects malformed metadata without treating it as current: %#", (value) => {
    expect(valid(value)).toBe(false);
  });
});
