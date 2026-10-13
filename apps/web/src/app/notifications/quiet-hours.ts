export type NotificationPreferences = {
  in_app_enabled: boolean;
  browser_enabled: boolean;
  quiet_from: string | null;
  quiet_until: string | null;
  time_zone: string;
};

/** Quiet hours are evaluated in the saved IANA zone, including intervals across midnight. */
export function isQuietTime(prefs: NotificationPreferences, at: Date): boolean {
  if (!prefs.quiet_from || !prefs.quiet_until) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: prefs.time_zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const current = hour * 60 + minute;
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const from = toMinutes(prefs.quiet_from),
    until = toMinutes(prefs.quiet_until);
  return from < until ? current >= from && current < until : current >= from || current < until;
}
