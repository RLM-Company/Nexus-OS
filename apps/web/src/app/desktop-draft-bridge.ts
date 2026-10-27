/** Narrow optional IPC API. Undefined in a normal browser or installed PWA. */
export interface DesktopTextDraftBridge {
  load(scope: string): Promise<{ ok: boolean; text?: string; message?: string }>;
  save(scope: string, text: string): Promise<{ ok: boolean; message?: string }>;
  clear(scope: string): Promise<{ ok: boolean }>;
  flush(scope: string, text: string): void;
}

const PREFIX = "cosmora:composer-draft:";
const MATERIALS = "cosmora:composer-materials:";
const SCOPE = /^(?:new-chat|(?:chat|project):[a-f0-9-]{8,64})$/i;

export function desktopDraftBridge(
  globalWindow: Window | undefined
): DesktopTextDraftBridge | null {
  if (!globalWindow) return null;
  const candidate = (globalWindow as Window & { kosmoraDesktopDraft?: DesktopTextDraftBridge })
    .kosmoraDesktopDraft;
  return candidate &&
    typeof candidate.load === "function" &&
    typeof candidate.save === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.flush === "function"
    ? candidate
    : null;
}

export function nativeDraftScope(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  const scope = key.slice(PREFIX.length);
  return SCOPE.test(scope) ? scope : null;
}

export function purgeUnscopedLegacyDrafts(
  storage: Pick<Storage, "length" | "key" | "removeItem">
): number {
  // Old Chromium storage is NOT account scoped: never migrate it into a new account.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX) || key?.startsWith(MATERIALS)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}
