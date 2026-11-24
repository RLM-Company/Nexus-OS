const STORAGE_KEY = "cosmora:document-answer-retries:v1";
const MAX_PENDING = 8;
const SAFE = /^[a-zA-Z0-9:_-]{1,160}$/u;

export type AnswerRetryMarker = {
  scope: string;
  sourceId: string;
  requestId: string;
};

type StoredMarker = AnswerRetryMarker & { at: number };

function readAll(storage: Storage): StoredMarker[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 8192) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_PENDING) return [];
    return parsed.filter((entry: unknown): entry is StoredMarker => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<Record<keyof StoredMarker, unknown>>;
      return (
        typeof value.scope === "string" &&
        SAFE.test(value.scope) &&
        typeof value.sourceId === "string" &&
        SAFE.test(value.sourceId) &&
        typeof value.requestId === "string" &&
        SAFE.test(value.requestId) &&
        typeof value.at === "number" &&
        Number.isFinite(value.at)
      );
    });
  } catch {
    return [];
  }
}

export function answerRetryScope(projectId: string): string {
  return `project:${projectId}`;
}

/** A stable per-attempt id so a lost response can be reconciled, never blindly re-dispatched. */
export function readAnswerRetry(
  projectId: string,
  sourceId: string
): AnswerRetryMarker | undefined {
  try {
    const scope = answerRetryScope(projectId);
    const marker = readAll(window.sessionStorage).find(
      (entry) => entry.scope === scope && entry.sourceId === sourceId
    );
    return marker
      ? { scope: marker.scope, sourceId: marker.sourceId, requestId: marker.requestId }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Write the marker BEFORE dispatching a retry POST; keep it if the response is lost. */
export function saveAnswerRetry(projectId: string, sourceId: string, requestId: string): void {
  try {
    const storage = window.sessionStorage;
    const scope = answerRetryScope(projectId);
    const rest = readAll(storage).filter(
      (entry) => !(entry.scope === scope && entry.sourceId === sourceId)
    );
    const next = [...rest, { scope, sourceId, requestId, at: Date.now() }].slice(-MAX_PENDING);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage failure must not block an explicit retry.
  }
}

/** Clear only after the server result is reconciled into the answer history. */
export function clearAnswerRetry(projectId: string, sourceId: string): void {
  try {
    const storage = window.sessionStorage;
    const scope = answerRetryScope(projectId);
    const rest = readAll(storage).filter(
      (entry) => !(entry.scope === scope && entry.sourceId === sourceId)
    );
    if (rest.length) storage.setItem(STORAGE_KEY, JSON.stringify(rest));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage failure must not interrupt reconciliation.
  }
}
