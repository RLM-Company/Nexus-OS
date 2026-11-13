import { describe, expect, it } from "vitest";
import { restoredRunState, type TerminalRunObservation } from "./restored-run-state";

const user = { run_id: "old", role: "user", status: "completed" as const };

describe("run restoration after a terminal observation", () => {
  for (const phase of ["completed", "failed", "cancelled"] as const) {
    const terminal: TerminalRunObservation = { runId: "old", phase };
    it(`keeps ${phase} when an assistant never existed or history is stale`, () => {
      for (const messages of [
        [user],
        [user, { ...user, role: "assistant", status: "pending" as const }],
        [user, { ...user, role: "assistant", status: "streaming" as const }]
      ]) {
        expect(restoredRunState(messages, terminal)).toEqual({ phase, activeRunId: null });
      }
    });
    it(`does not let the previous ${phase} run suppress a new request`, () => {
      const newer = { ...user, run_id: "new" };
      expect(restoredRunState([user, newer], terminal)).toEqual({
        phase: "queued",
        activeRunId: "new"
      });
      expect(
        restoredRunState(
          [user, newer, { ...newer, role: "assistant", status: "streaming" }],
          terminal
        )
      ).toEqual({ phase: "streaming", activeRunId: "new" });
    });
  }
  it("does not invent a terminal result before an authoritative observation", () => {
    expect(restoredRunState([user])).toEqual({ phase: "queued", activeRunId: "old" });
    expect(restoredRunState([])).toEqual({ phase: "idle", activeRunId: null });
    expect(restoredRunState([{ ...user, run_id: null }])).toEqual({
      phase: "idle",
      activeRunId: null
    });
    for (const [status, phase] of [
      ["pending", "running"],
      ["streaming", "streaming"],
      ["completed", "completed"],
      ["failed", "failed"],
      ["cancelled", "cancelled"]
    ] as const) {
      expect(restoredRunState([user, { ...user, role: "assistant", status }])).toEqual({
        phase,
        activeRunId: ["pending", "streaming"].includes(status) ? "old" : null
      });
    }
  });
});
