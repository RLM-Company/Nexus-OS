import { describe, expect, it } from "vitest";
import { acceptsCodeSnapshot } from "./snapshot-order";

describe("Code snapshots cannot rewind the active run", () => {
  it("uses durable revision before network arrival or request order", () => {
    const current = { id: "run", version: 8, sequence: 5 };
    expect(acceptsCodeSnapshot(current, { id: "run", version: 7 }, 10)).toBe(false);
    expect(acceptsCodeSnapshot(current, { id: "run", version: 9 }, 2)).toBe(true);
    expect(acceptsCodeSnapshot(current, { id: "run", version: 8 }, 4)).toBe(false);
    expect(acceptsCodeSnapshot(current, { id: "run", version: 8 }, 6)).toBe(true);
  });
  it("keeps legacy reads usable without allowing late older requests to win", () => {
    const current = { id: "legacy", sequence: 5 };
    expect(acceptsCodeSnapshot(current, { id: "legacy" }, 2)).toBe(false);
    expect(acceptsCodeSnapshot(current, { id: "legacy" }, 6)).toBe(true);
    expect(acceptsCodeSnapshot(current, { id: "legacy", version: 1 }, 2)).toBe(false);
    expect(acceptsCodeSnapshot(current, { id: "legacy", version: 1 }, 6)).toBe(true);
  });
  it("does not downgrade a known revision to missing or malformed evidence", () => {
    const current = { id: "run", version: 8, sequence: 5 };
    for (const version of [undefined, null, 0, -1, NaN, Infinity, 1.5]) {
      expect(acceptsCodeSnapshot(current, { id: "run", version }, 10)).toBe(false);
    }
  });
  it("scopes revisions to one run and admits a first legacy or versioned snapshot", () => {
    expect(acceptsCodeSnapshot(null, { id: "first" }, 1)).toBe(true);
    expect(acceptsCodeSnapshot(null, { id: "first", version: 1 }, 1)).toBe(true);
    expect(
      acceptsCodeSnapshot({ id: "old", version: 100, sequence: 10 }, { id: "new", version: 1 }, 11)
    ).toBe(true);
  });
});
