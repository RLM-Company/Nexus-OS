const LEGACY_KEY = "cosmora:pending-chat-send:v1";
const STORAGE_KEY = "cosmora:pending-chat-sends:v2";
const NEW_CHAT_SCOPE = "new";
const MAX_PENDING = 16;
const SHA256 = /^[a-f0-9]{64}$/;
const CLIENT_ID = /^[a-z0-9-]{1,128}$/;

type RetryKey = { scope: string; fingerprint: string };
type RetryMarker = RetryKey & { id: string };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function chatSendRetryKey(path: string, payload: string): Promise<RetryKey | null> {
  try {
    const [scope, fingerprint] = await Promise.all([
      path === "/api/v1/chats" ? NEW_CHAT_SCOPE : sha256(path),
      sha256(path + "\n" + payload)
    ]);
    return { scope, fingerprint };
  } catch {
    return null;
  }
}

function readMarkers(storage: Storage): RetryMarker[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw || raw.length > 8192) return [];
  try {
    const markers: unknown = JSON.parse(raw);
    if (!Array.isArray(markers) || markers.length > MAX_PENDING) return [];
    return markers.filter((marker): marker is RetryMarker => {
      if (!marker || typeof marker !== "object") return false;
      const { scope, fingerprint, id } = marker;
      return (
        typeof scope === "string" &&
        (scope === NEW_CHAT_SCOPE || SHA256.test(scope)) &&
        typeof fingerprint === "string" &&
        SHA256.test(fingerprint) &&
        typeof id === "string" &&
        CLIENT_ID.test(id)
      );
    });
  } catch {
    return [];
  }
}

export function readChatSendRetry(key: RetryKey): string | undefined {
  try {
    const storage = window.sessionStorage;
    const existing = readMarkers(storage).find((entry) => entry.scope === key.scope);
    if (existing) return existing.fingerprint === key.fingerprint ? existing.id : undefined;
    const raw = storage.getItem(LEGACY_KEY);
    const legacy = raw && raw.length <= 512 ? JSON.parse(raw) : null;
    if (
      legacy?.fingerprint === key.fingerprint &&
      typeof legacy.id === "string" &&
      CLIENT_ID.test(legacy.id)
    )
      return legacy.id;
  } catch {
    // The in-memory retry is still available if tab storage is blocked.
  }
}

export function saveChatSendRetry(key: RetryKey, id: string): void {
  try {
    const storage = window.sessionStorage;
    const markers = readMarkers(storage).filter((entry) => entry.scope !== key.scope);
    storage.setItem(STORAGE_KEY, JSON.stringify([...markers, { ...key, id }].slice(-MAX_PENDING)));
    storage.removeItem(LEGACY_KEY);
  } catch {
    // Storage failure must not block an explicit send.
  }
}

export function clearChatSendRetry(scope: string, id?: string): void {
  try {
    const storage = window.sessionStorage;
    const current = readMarkers(storage);
    const remaining = current.filter(
      (entry) => entry.scope !== scope || (id !== undefined && entry.id !== id)
    );
    if (!remaining.length) storage.removeItem(STORAGE_KEY);
    else if (remaining.length !== current.length)
      storage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Storage failure must not interrupt acknowledgement.
  }
}

export function clearNewChatRetry(): void {
  clearChatSendRetry(NEW_CHAT_SCOPE);
  try {
    // Version one had no scope, so retain its original behavior on an explicit reset.
    window.sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // The fresh composer remains usable with storage disabled.
  }
}
