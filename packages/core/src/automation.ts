/** Pure automation scheduling helpers. No timers, no model calls, no I/O. */
export { automationOccurrenceKey, eventDedupeKey } from "@cosmora/contracts/automation";

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ScheduleMode = "once" | "daily" | "weekdays" | "weekly";
export type ScheduleSpec = {
  mode: ScheduleMode;
  time_zone: string;
  local_time: string; // HH:mm
  due_at: string; // next UTC instant (ISO)
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Validate an IANA time zone; invalid zones are rejected instead of silently UTC. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isScheduleSpecValid(spec: ScheduleSpec): boolean {
  if (!ISO.test(spec.due_at) || !Number.isFinite(Date.parse(spec.due_at))) return false;
  if (!isValidTimeZone(spec.time_zone)) return false;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.local_time)) return false;
  return ["once", "daily", "weekdays", "weekly"].includes(spec.mode);
}

/** Local wall-clock components in the owner's time zone. */
const localParts = (date: Date, timeZone: string) => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
};

/** Build a UTC instant from local wall-clock fields in a time zone.
 * Ambiguous/nonexistent times (DST transitions) move forward to the first valid
 * minute; we never repeat a wall-clock hour silently twice. */
const fromLocal = (
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): string => {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Iterate to a fixed point: find the UTC instant whose wall-clock fields in
  // the zone equal the requested local fields. Converges across DST boundaries.
  let candidate = desired;
  for (let i = 0; i < 3; i += 1) {
    const actual = localParts(new Date(candidate), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0
    );
    candidate += desired - actualUtc;
  }
  return new Date(candidate).toISOString();
};

/** Next UTC instant strictly after `nowIso`, computed from the configured local
 * wall-clock time in `timeZone`. Missed repeats coalesce to one future run;
 * weekdays shift Saturday/Sunday to Monday in that zone. Returns null for once. */
export function nextAutomationDueAt(
  spec: ScheduleSpec,
  nowIso: string,
  timeZoneOverride?: string
): string | null {
  if (spec.mode === "once") return null;
  const zone =
    timeZoneOverride && isValidTimeZone(timeZoneOverride) ? timeZoneOverride : spec.time_zone;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now) || !isScheduleSpecValid(spec)) return null;
  const [hour, minute] = spec.local_time.split(":").map(Number) as [number, number];
  const start = localParts(new Date(Date.parse(spec.due_at)), zone);
  const stepDays = spec.mode === "weekly" ? 7 : 1;
  const today = localParts(new Date(now), zone);
  const dayOrdinal = (p: { year: number; month: number; day: number }) =>
    Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
  const candidateDay = dayOrdinal(start);
  const nowDay = dayOrdinal(today);
  // Earliest day whose occurrence is strictly in the future.
  let steps = Math.max(0, Math.floor((nowDay - candidateDay) / stepDays));
  while (true) {
    const dayNumber = candidateDay + steps * stepDays;
    const d = new Date(dayNumber * DAY_MS);
    const fields = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    if (spec.mode === "weekdays") {
      const weekday = d.getUTCDay();
      if (weekday === 0 || weekday === 6) {
        steps += 1;
        continue;
      }
    }
    // Guard against pathological loops from invalid zones.
    if (steps > 100000) return null;
    const due = fromLocal(zone, fields.year, fields.month, fields.day, hour, minute);
    if (Date.parse(due) > now && due !== spec.due_at) return due;
    steps += 1;
  }
}

/** Human-readable local rendering for the UI; never invents a time zone. */
export const formatAutomationDue = (iso: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

export const padLocalTime = (hour: number, minute: number): string => `${pad(hour)}:${pad(minute)}`;
