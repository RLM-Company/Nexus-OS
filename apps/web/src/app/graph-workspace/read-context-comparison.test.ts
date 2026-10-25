import { expect, it, vi } from "vitest";
import type {
  IntelligenceGraphContextPreview,
  IntelligenceGraphContextState
} from "@cosmora/contracts";
import { readContextComparison } from "./read-context-comparison";

const setup = () => {
  const state: IntelligenceGraphContextState = {
    materials_version: 4,
    current_sha256: "a".repeat(64),
    already_applied: false,
    can_apply: true,
    retained_files: []
  };
  const make = (
    revision: number,
    sha: string
  ): IntelligenceGraphContextPreview & { state: IntelligenceGraphContextState } => ({
    state: { ...state },
    sha256: sha,
    attachment: {
      name: "graph-context-g.json",
      content: JSON.stringify({
        format: "kosmora.graph-context.v1",
        graph: { id: "g", revision },
        query: revision === 1 ? "saved query" : "new query",
        nodes: [],
        edges: [],
        conflicts: []
      })
    },
    statistics: {
      nodes: 0,
      edges: 0,
      conflicts: 0,
      omitted_nodes: 0,
      omitted_edges: 0,
      characters: 0,
      bytes: 0,
      retrieval_truncated: false
    }
  });
  const proposed = make(2, "b".repeat(64)),
    saved = make(1, "a".repeat(64));
  const status = {
    status: "stale",
    graph_revision: 2,
    materials_version: 4,
    current_sha256: "a".repeat(64),
    saved: { revision: 1, query: "saved query" }
  };
  const read = vi.fn(() => Promise.resolve(saved));
  return { proposed, saved, status, read };
};

it("reads the stored query/revision rather than silently reusing the proposed query", async () => {
  const f = setup();
  const before = structuredClone(f.proposed);
  const result = await readContextComparison(f.proposed, () => Promise.resolve(f.status), f.read);
  expect(f.read).toHaveBeenCalledExactlyOnceWith("saved query", 1);
  expect(result.savedRevision).toBe(1);
  expect(result.changes).toHaveLength(1);
  expect(f.proposed).toEqual(before);
});
it.each(["missing", "unrecognized", "bad-response", "new-materials", "new-hash"])(
  "refuses %s before loading a baseline",
  async (kind) => {
    const f = setup();
    const status =
      kind === "missing"
        ? { ...f.status, status: "missing", current_sha256: null, saved: null }
        : kind === "unrecognized"
          ? { ...f.status, status: "unrecognized", saved: null }
          : kind === "bad-response"
            ? { error: "unavailable" }
            : kind === "new-materials"
              ? { ...f.status, materials_version: 5 }
              : { ...f.status, current_sha256: "c".repeat(64) };
    await expect(
      readContextComparison(f.proposed, () => Promise.resolve(status), f.read)
    ).rejects.toThrow();
    expect(f.read).not.toHaveBeenCalled();
  }
);
it.each(["payload-hash", "materials-version", "stored-hash"])(
  "rejects a baseline race affecting %s",
  async (kind) => {
    const f = setup();
    if (kind === "payload-hash") f.saved.sha256 = "d".repeat(64);
    if (kind === "materials-version") f.saved.state.materials_version++;
    if (kind === "stored-hash") f.saved.state.current_sha256 = "d".repeat(64);
    await expect(
      readContextComparison(f.proposed, () => Promise.resolve(f.status), f.read)
    ).rejects.toThrow(/во время сравнения/);
  }
);
it("propagates an unavailable status without retrying reads or making a write", async () => {
  const f = setup();
  const readStatus = vi.fn(() => Promise.reject(new Error("unavailable")));
  await expect(readContextComparison(f.proposed, readStatus, f.read)).rejects.toThrow(
    "unavailable"
  );
  expect(readStatus).toHaveBeenCalledTimes(1);
  expect(f.read).not.toHaveBeenCalled();
});
