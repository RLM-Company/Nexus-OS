import { describe, expect, it } from "vitest";
import { recoverableRunDraft } from "./recoverable-run-draft";

const user = {
  id: "source-user",
  run_id: "source-run",
  role: "user",
  status: "completed" as const,
  content: "19 700 ₽; 00123; 13.11.2026; кроме доставки",
  attachments: [{ name: "source.txt", content: "Не включать доставку: 00123" }]
};

describe("request recovery uses the latest authoritative run", () => {
  for (const phase of ["failed", "cancelled"] as const) {
    it(`recovers original bytes after ${phase} even when an assistant never existed`, () => {
      expect(recoverableRunDraft([user], { runId: user.run_id, phase })).toBe(user);
    });
    it(`recovers a history-confirmed ${phase} request without requiring an SSE observation`, () => {
      expect(recoverableRunDraft([user, { ...user, role: "assistant", status: phase }])).toBe(user);
    });
    it(`does not recover an older ${phase} request while the latest request is active or complete`, () => {
      const old = { ...user, role: "assistant", status: phase };
      const next = { ...user, id: "new-user", run_id: "new-run" };
      expect(recoverableRunDraft([user, old, next], { runId: user.run_id, phase })).toBeNull();
      expect(
        recoverableRunDraft([user, old, next], { runId: next.run_id, phase: "completed" })
      ).toBeNull();
      for (const status of ["pending", "streaming", "completed"] as const) {
        expect(
          recoverableRunDraft([user, old, next, { ...next, role: "assistant", status }])
        ).toBeNull();
      }
    });
    it(`honors ${phase} when the assistant history still says streaming`, () => {
      expect(
        recoverableRunDraft([user, { ...user, role: "assistant", status: "streaming" }], {
          runId: user.run_id,
          phase
        })
      ).toBe(user);
    });
  }
  it("does not invent a failure, recover a completed run or expose a different run's request", () => {
    expect(recoverableRunDraft([])).toBeNull();
    expect(recoverableRunDraft([user])).toBeNull();
    expect(recoverableRunDraft([user], { runId: user.run_id, phase: "completed" })).toBeNull();
    expect(recoverableRunDraft([user], { runId: "other-run", phase: "failed" })).toBeNull();
    expect(
      recoverableRunDraft([{ ...user, run_id: null }], { runId: user.run_id, phase: "cancelled" })
    ).toBeNull();
    expect(
      recoverableRunDraft([user, { ...user, role: "assistant", status: "failed" }], {
        runId: user.run_id,
        phase: "completed"
      })
    ).toBeNull();
  });
});
