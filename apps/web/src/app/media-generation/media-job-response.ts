import type { MediaJob } from "./media-panel";

/** A malformed 200 response must not be interpreted as an empty owner job list. */
export function parseMediaJobListResponse(value: unknown): MediaJob[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid media history response");
  const entries = (value as Record<string, unknown>).items;
  if (!Array.isArray(entries) || !entries.every(isValidMediaJobSummary))
    throw new Error("Invalid media job list");
  return entries as MediaJob[];
}

function isValidMediaJobSummary(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(item.id) &&
    (item.kind === "image" || item.kind === "speech" || item.kind === "transcription") &&
    (item.status === "queued" ||
      item.status === "running" ||
      item.status === "done" ||
      item.status === "failed" ||
      item.status === "cancelled") &&
    (item.client_request_id === undefined ||
      item.client_request_id === null ||
      typeof item.client_request_id === "string")
  );
}
