import { describe, expect, it } from "vitest";
import { nextDispatchAt, tickScheduledDispatches } from "../src/scheduled-dispatch.js";

describe("nextDispatchAt", () => {
  it("once has no next occurrence", () => {
    expect(nextDispatchAt("once", "2026-11-16T09:00:00.000Z", "2026-11-17T00:00:00.000Z")).toBe(
      null
    );
  });

  it("daily and weekly coalesce missed intervals strictly after now", () => {
    expect(nextDispatchAt("daily", "2026-11-16T09:00:00.000Z", "2026-11-19T09:00:00.000Z")).toBe(
      "2026-11-20T09:00:00.000Z"
    );
    expect(nextDispatchAt("weekly", "2026-11-16T09:00:00.000Z", "2026-11-24T09:00:00.000Z")).toBe(
      "2026-11-30T09:00:00.000Z"
    );
  });

  it("weekdays skips Saturday and Sunday", () => {
    // 2026-11-20 is Friday, +1 day = Saturday, +2 = Sunday, +3 = Monday.
    expect(nextDispatchAt("weekdays", "2026-11-20T09:00:00.000Z", "2026-11-20T09:00:00.000Z")).toBe(
      "2026-11-23T09:00:00.000Z"
    );
  });

  it("returns null on malformed dates", () => {
    expect(nextDispatchAt("daily", "bad", "2026-11-16T09:00:00.000Z")).toBe(null);
  });
});

describe("tickScheduledDispatches", () => {
  it("marks due items ready and reschedules repeating ones", () => {
    const due = [
      {
        id: "1",
        owner_id: "a",
        kind: "message" as const,
        mode: "once" as const,
        due_at: "2026-11-16T09:00:00.000Z",
        status: "scheduled" as const,
        payload: { text: "Привет" }
      },
      {
        id: "2",
        owner_id: "a",
        kind: "work_task" as const,
        mode: "daily" as const,
        due_at: "2026-11-16T09:00:00.000Z",
        status: "scheduled" as const,
        payload: { text: "Отчёт" }
      }
    ];
    const result = tickScheduledDispatches(due, "2026-11-17T10:00:00.000Z");
    expect(result.readyIds).toEqual(["1", "2"]);
    expect(result.rescheduled).toEqual([{ id: "2", next_due_at: "2026-11-18T09:00:00.000Z" }]);
  });
});
