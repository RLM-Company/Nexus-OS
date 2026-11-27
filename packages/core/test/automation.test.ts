import { describe, expect, it } from "vitest";
import {
  isScheduleSpecValid,
  isValidTimeZone,
  nextAutomationDueAt,
  automationOccurrenceKey,
  eventDedupeKey,
  formatAutomationDue
} from "../src/automation.js";

describe("server-side automation scheduling", () => {
  it("keeps local wall-clock time across DST in Europe/Moscow and rejects invalid zones", () => {
    expect(isValidTimeZone("Europe/Moscow")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    const spec = {
      mode: "daily" as const,
      time_zone: "Europe/Moscow",
      local_time: "09:30",
      due_at: "2026-03-27T06:30:00.000Z"
    };
    const next = nextAutomationDueAt(spec, "2026-03-28T10:00:00.000Z")!;
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(next));
    expect(local).toBe("09:30");
  });

  it("shifts weekdays off the weekend and coalesces missed repeats", () => {
    // 2026-11-28 is Saturday; next weekday with 09:00 Moscow time is Monday.
    const spec = {
      mode: "weekdays" as const,
      time_zone: "Europe/Moscow",
      local_time: "09:00",
      due_at: "2026-11-27T06:00:00.000Z"
    };
    const next = nextAutomationDueAt(spec, "2026-11-28T08:00:00.000Z")!;
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      weekday: "short"
    }).format(new Date(next));
    expect(day).toBe("Mon");
    expect(isScheduleSpecValid({ ...spec, local_time: "25:00" })).toBe(false);
  });

  it("gives stable occurrence and event keys independent of binding order", () => {
    expect(
      automationOccurrenceKey({ triggerId: "t1", kind: "event", source: "drive", eventId: "e1" })
    ).toBe("event:drive:e1:t1");
    expect(
      automationOccurrenceKey({
        triggerId: "t1",
        kind: "schedule",
        dueAt: "2026-01-01T00:00:00.000Z"
      })
    ).toBe("schedule:t1:2026-01-01T00:00:00.000Z");
    expect(eventDedupeKey("drive", "e1")).toBe("drive\u0000e1");
    expect(formatAutomationDue("2026-01-01T00:00:00.000Z", "Not/AZone")).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });
});
