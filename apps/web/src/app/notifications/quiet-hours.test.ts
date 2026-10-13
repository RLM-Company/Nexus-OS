import { describe, expect, it } from "vitest";
import { isQuietTime, type NotificationPreferences } from "./quiet-hours";

const prefs: NotificationPreferences = {
  in_app_enabled: true,
  browser_enabled: true,
  quiet_from: "22:00",
  quiet_until: "07:30",
  time_zone: "Europe/Moscow"
};
describe("notification quiet hours", () => {
  it("handles midnight and the selected time zone", () => {
    expect(isQuietTime(prefs, new Date("2026-10-12T18:59:00Z"))).toBe(false);
    expect(isQuietTime(prefs, new Date("2026-10-12T19:00:00Z"))).toBe(true);
    expect(isQuietTime(prefs, new Date("2026-10-13T04:29:00Z"))).toBe(true);
    expect(isQuietTime(prefs, new Date("2026-10-13T04:30:00Z"))).toBe(false);
    expect(isQuietTime({ ...prefs, quiet_from: null, quiet_until: null }, new Date())).toBe(false);
  });
});
